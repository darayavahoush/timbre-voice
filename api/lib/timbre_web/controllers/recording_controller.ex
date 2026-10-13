defmodule TimbreWeb.RecordingController do
  use TimbreWeb, :controller

  alias Timbre.{ByteRange, Recordings}

  action_fallback TimbreWeb.FallbackController

  def index(conn, _params) do
    render(conn, :index, recordings: Recordings.list_recordings())
  end

  def show(conn, %{"id" => id}) do
    with {:ok, recording} <- fetch(id), do: render(conn, :show, recording: recording)
  end

  @doc """
  `multipart/form-data` with an `audio` file part plus optional text fields:
  `title`, `duration_ms`, `sample_rate`, `kind`, `parent_id`, `effects` (JSON).
  """
  def create(conn, %{"audio" => %Plug.Upload{} = upload} = params) do
    with {:ok, effects} <- decode_effects(params["effects"]),
         {:ok, audio} <- read_upload(upload),
         {:ok, recording} <-
           params
           |> Map.take(~w(title kind duration_ms sample_rate parent_id))
           |> Map.merge(%{
             "audio" => audio,
             "mime_type" => mime_for(upload),
             "effects" => effects
           })
           |> Recordings.create_recording() do
      conn
      |> put_status(:created)
      |> put_resp_header("location", ~p"/api/recordings/#{recording.id}")
      |> render(:show, recording: recording)
    end
  end

  def create(_conn, _params),
    do: {:error, :bad_request, "multipart field `audio` (the recording) is required"}

  def update(conn, %{"id" => id} = params) do
    with {:ok, recording} <- fetch(id),
         {:ok, recording} <- Recordings.update_recording(recording, Map.take(params, ["title"])) do
      render(conn, :show, recording: recording)
    end
  end

  def delete(conn, %{"id" => id}) do
    with {:ok, recording} <- fetch(id),
         {:ok, _} <- Recordings.delete_recording(recording) do
      send_resp(conn, :no_content, "")
    end
  end

  @doc "Streams the stored audio with ETag + Range support (206) so players can seek."
  def audio(conn, %{"id" => id}) do
    with {:ok, rec} <- fetch(id) do
      etag = ~s("#{rec.id}-#{rec.byte_size}-#{DateTime.to_unix(rec.inserted_at)}")

      conn =
        conn
        |> put_resp_content_type(rec.mime_type, nil)
        |> put_resp_header("accept-ranges", "bytes")
        |> put_resp_header("etag", etag)
        |> put_resp_header("cache-control", "private, no-cache")

      cond do
        etag in get_req_header(conn, "if-none-match") ->
          send_resp(conn, 304, "")

        true ->
          case ByteRange.parse(get_req_header(conn, "range"), rec.byte_size) do
            :full ->
              send_resp(conn, 200, Recordings.read_audio(rec.id))

            {:ok, first, last} ->
              conn
              |> put_resp_header("content-range", "bytes #{first}-#{last}/#{rec.byte_size}")
              |> send_resp(206, Recordings.read_audio_slice(rec.id, first, last - first + 1))

            :unsatisfiable ->
              conn
              |> put_resp_header("content-range", "bytes */#{rec.byte_size}")
              |> send_resp(416, "")
          end
      end
    end
  end

  @doc "SubRip subtitles built from the stored Whisper segments, as a file download."
  def srt(conn, %{"id" => id}) do
    with {:ok, rec} <- fetch(id),
         {:ok, srt} <- build_srt(rec) do
      disposition = ~s(attachment; filename="#{srt_filename(rec)}")

      conn
      |> put_resp_content_type("application/x-subrip", "utf-8")
      |> put_resp_header("content-disposition", disposition)
      |> send_resp(200, srt)
    end
  end

  defp build_srt(rec) do
    case Timbre.Subtitles.to_srt(rec.segments) do
      "" -> {:error, :not_found, "no timed transcript yet: run Transcribe first"}
      srt -> {:ok, srt}
    end
  end

  # Header-safe ASCII filename from the title.
  defp srt_filename(%{id: id, title: title}) do
    slug =
      title
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9]+/, "-")
      |> String.trim("-")
      |> String.slice(0, 60)

    if slug == "", do: "recording-#{id}.srt", else: "#{slug}.srt"
  end

  @doc "Transcribe + summarize (bonus). Needs OPENAI_API_KEY (any OpenAI-compatible API)."
  def transcribe(conn, %{"id" => id}) do
    with {:ok, recording} <- fetch(id),
         {:ok, result} <- Timbre.Transcription.run(recording),
         {:ok, recording} <- Recordings.save_transcript(recording, result) do
      render(conn, :show, recording: recording)
    end
  end

  defp fetch(id) do
    with {int, ""} <- Integer.parse(id),
         %{} = recording <- Recordings.get_recording(int) do
      {:ok, recording}
    else
      _ -> {:error, :not_found}
    end
  end

  defp read_upload(%Plug.Upload{path: path}) do
    case File.read(path) do
      {:ok, bytes} -> {:ok, bytes}
      {:error, _} -> {:error, :bad_request, "could not read the uploaded file"}
    end
  end

  # Browsers label the part with the Blob's type; fall back to the extension
  # if some client sends application/octet-stream.
  defp mime_for(%Plug.Upload{content_type: ct, filename: filename}) do
    if ct in [nil, "", "application/octet-stream"], do: MIME.from_path(filename || ""), else: ct
  end

  defp decode_effects(nil), do: {:ok, %{}}
  defp decode_effects(""), do: {:ok, %{}}

  defp decode_effects(json) when is_binary(json) do
    case Jason.decode(json) do
      {:ok, %{} = map} -> {:ok, map}
      _ -> {:error, :bad_request, "`effects` must be a JSON object"}
    end
  end

  defp decode_effects(_), do: {:error, :bad_request, "`effects` must be a JSON object"}
end
