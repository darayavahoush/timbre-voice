defmodule Timbre.Transcription do
  @moduledoc """
  Transcribe a stored recording and produce a short title + summary.

  Talks to any OpenAI-compatible API (OpenAI, Groq, a local server, ...):

    * `POST {base_url}/audio/transcriptions` — Whisper-style speech to text
    * `POST {base_url}/chat/completions`     — title + summary from the transcript

  Configure with `OPENAI_API_KEY` (required), `OPENAI_BASE_URL`,
  `TRANSCRIPTION_MODEL` (default `whisper-1`) and `SUMMARY_MODEL`
  (default `gpt-4o-mini`). Without a key `run/1` returns `:not_configured` and
  the API answers 503 — the rest of the app is unaffected.
  """
  alias Timbre.Recordings
  alias Timbre.Recordings.Recording

  @defaults [
    base_url: "https://api.openai.com/v1",
    transcription_model: "whisper-1",
    chat_model: "gpt-4o-mini",
    req_options: []
  ]

  # Keeps the prompt bounded for very long takes (~6k tokens).
  @max_prompt_chars 24_000

  @type result :: %{
          transcript: String.t(),
          title: String.t(),
          summary: String.t(),
          segments: [Timbre.Subtitles.segment()]
        }

  @spec run(Recording.t()) ::
          {:ok, result()}
          | {:error, :not_configured | :upstream | :not_found, String.t()}
          | {:error, :not_found}
  def run(%Recording{} = recording) do
    with {:ok, cfg} <- config(),
         {:ok, audio} <- load_audio(recording),
         {:ok, transcript, segments} <- transcribe(cfg, recording, audio) do
      case String.trim(transcript) do
        "" ->
          {:ok,
           %{
             transcript: "",
             title: "Silent recording",
             summary: "No speech detected.",
             segments: []
           }}

        text ->
          with {:ok, %{title: title, summary: summary}} <- summarize(cfg, text) do
            {:ok, %{transcript: text, title: title, summary: summary, segments: segments}}
          end
      end
    end
  end

  defp config do
    cfg = Keyword.merge(@defaults, Application.get_env(:timbre, __MODULE__, []))

    case cfg[:api_key] do
      key when is_binary(key) and key != "" ->
        {:ok, cfg}

      _ ->
        {:error, :not_configured,
         "Transcription is not configured: set OPENAI_API_KEY on the server"}
    end
  end

  defp load_audio(%Recording{id: id}) do
    case Recordings.read_audio(id) do
      nil -> {:error, :not_found}
      audio -> {:ok, audio}
    end
  end

  defp transcribe(cfg, recording, audio) do
    request =
      [
        method: :post,
        url: cfg[:base_url] <> "/audio/transcriptions",
        auth: {:bearer, cfg[:api_key]},
        receive_timeout: 120_000,
        retry: false,
        form_multipart: [
          file: {audio, filename: filename(recording), content_type: recording.mime_type},
          model: cfg[:transcription_model],
          # verbose_json adds per-segment timings (used for SRT export); the
          # `text` field is still there, so other consumers are unaffected.
          response_format: "verbose_json"
        ]
      ] ++ cfg[:req_options]

    case Req.request(request) do
      {:ok, %Req.Response{status: 200, body: %{"text" => text} = body}} when is_binary(text) ->
        # Providers that ignore verbose_json just return no segments -> no SRT.
        {:ok, text, Timbre.Subtitles.from_verbose_json(body["segments"])}

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, :upstream, "transcription failed (HTTP #{status}): #{error_message(body)}"}

      {:error, exception} ->
        {:error, :upstream,
         "could not reach the transcription API: #{Exception.message(exception)}"}
    end
  end

  defp summarize(cfg, transcript) do
    prompt = String.slice(transcript, 0, @max_prompt_chars)

    request =
      [
        method: :post,
        url: cfg[:base_url] <> "/chat/completions",
        auth: {:bearer, cfg[:api_key]},
        receive_timeout: 60_000,
        retry: false,
        json: %{
          model: cfg[:chat_model],
          temperature: 0.2,
          response_format: %{type: "json_object"},
          messages: [
            %{
              role: "system",
              content:
                "You summarize voice recordings. Reply with a JSON object " <>
                  ~s({"title": string, "summary": string}. ) <>
                  "title: at most 6 words, no quotes or trailing punctuation. " <>
                  "summary: 1-3 plain sentences covering the key points. " <>
                  "Use the same language as the transcript."
            },
            %{role: "user", content: prompt}
          ]
        }
      ] ++ cfg[:req_options]

    with {:ok, %Req.Response{status: 200, body: body}} <- Req.request(request),
         content when is_binary(content) <-
           get_in(body, ["choices", Access.at(0), "message", "content"]),
         {:ok, %{"title" => title, "summary" => summary}}
         when is_binary(title) and is_binary(summary) <-
           Jason.decode(content) do
      {:ok,
       %{title: title |> String.trim() |> String.slice(0, 120), summary: String.trim(summary)}}
    else
      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, :upstream, "summary failed (HTTP #{status}): #{error_message(body)}"}

      {:error, exception} when is_exception(exception) ->
        {:error, :upstream, "could not reach the summary API: #{Exception.message(exception)}"}

      _ ->
        {:error, :upstream, "the summary API returned an unexpected response"}
    end
  end

  defp error_message(%{"error" => %{"message" => message}}) when is_binary(message), do: message
  defp error_message(body) when is_binary(body), do: String.slice(body, 0, 200)
  defp error_message(body), do: body |> inspect() |> String.slice(0, 200)

  # Whisper-style APIs sniff the container from the file name, and they don't
  # know every extension MIME.extensions/1 offers (e.g. "weba").
  defp filename(%Recording{id: id, mime_type: mime}) do
    ext =
      case mime do
        "audio/webm" -> "webm"
        "audio/ogg" -> "ogg"
        "audio/mp4" -> "m4a"
        "audio/mpeg" -> "mp3"
        m when m in ["audio/wav", "audio/x-wav", "audio/wave"] -> "wav"
        _ -> "webm"
      end

    "recording-#{id}.#{ext}"
  end
end
