defmodule Timbre.Recordings.Recording do
  @moduledoc """
  One stored take. The audio bytes live in the row (SQLite BLOB) so the whole
  app is a single file to back up — but the column is `load_in_query: false`,
  so listing recordings never drags megabytes of audio through the driver.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @kinds ~w(original processed mix)
  @max_bytes 50 * 1024 * 1024

  schema "recordings" do
    field :title, :string
    field :kind, :string, default: "original"
    field :mime_type, :string
    field :duration_ms, :integer, default: 0
    field :byte_size, :integer
    field :sample_rate, :integer
    field :audio, :binary, load_in_query: false
    field :effects, :map, default: %{}
    field :transcript, :string
    field :summary, :string
    # timed transcript segments (see Timbre.Subtitles); stored as JSON text
    field :segments, {:array, :map}

    belongs_to :parent, __MODULE__

    timestamps(type: :utc_datetime)
  end

  def kinds, do: @kinds
  def max_bytes, do: @max_bytes

  @doc "Changeset for creating a recording (audio + metadata)."
  def create_changeset(recording, attrs) do
    recording
    |> cast(attrs, [
      :title,
      :kind,
      :mime_type,
      :duration_ms,
      :sample_rate,
      :audio,
      :effects,
      :parent_id,
      :transcript,
      :summary,
      :segments
    ])
    |> update_change(:mime_type, &normalize_mime/1)
    |> update_change(:title, &trim/1)
    |> default_title()
    |> validate_required([:mime_type, :audio])
    |> validate_inclusion(:kind, @kinds)
    |> validate_length(:title, max: 120)
    |> validate_number(:duration_ms, greater_than_or_equal_to: 0, less_than: 24 * 3_600_000)
    |> validate_number(:sample_rate, greater_than: 0, less_than: 400_000)
    |> validate_audio()
  end

  @doc "Changeset for the fields a user may edit afterwards."
  def update_changeset(recording, attrs) do
    recording
    |> cast(attrs, [:title, :transcript, :summary, :segments])
    |> update_change(:title, &trim/1)
    |> validate_required([:title])
    |> validate_length(:title, min: 1, max: 120)
  end

  defp trim(value) when is_binary(value), do: String.trim(value)
  defp trim(value), do: value

  # "audio/webm;codecs=opus" -> "audio/webm"; anything that isn't audio is
  # kept as-is so validation can reject it with a useful message.
  defp normalize_mime(nil), do: nil

  defp normalize_mime(mime) do
    mime |> String.split(";", parts: 2) |> hd() |> String.trim() |> String.downcase()
  end

  defp default_title(changeset) do
    case get_field(changeset, :title) do
      t when t in [nil, ""] -> put_change(changeset, :title, "Untitled recording")
      _ -> changeset
    end
  end

  defp validate_audio(changeset) do
    changeset =
      validate_change(changeset, :mime_type, fn :mime_type, mime ->
        if String.starts_with?(mime, "audio/"),
          do: [],
          else: [mime_type: "must be an audio/* type, got #{mime}"]
      end)

    case get_change(changeset, :audio) do
      nil ->
        changeset

      audio when byte_size(audio) == 0 ->
        add_error(changeset, :audio, "can't be empty")

      audio when byte_size(audio) > @max_bytes ->
        add_error(changeset, :audio, "is too large (max #{div(@max_bytes, 1_048_576)} MB)")

      audio ->
        put_change(changeset, :byte_size, byte_size(audio))
    end
  end
end
