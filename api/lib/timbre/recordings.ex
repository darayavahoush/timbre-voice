defmodule Timbre.Recordings do
  @moduledoc "Context for stored recordings."
  import Ecto.Query, warn: false

  alias Timbre.Recordings.Recording
  alias Timbre.Repo

  @doc "All recordings, newest first. Audio bytes are NOT loaded."
  def list_recordings do
    Repo.all(from r in Recording, order_by: [desc: r.inserted_at, desc: r.id])
  end

  @doc "Metadata for one recording (no audio bytes), or nil."
  def get_recording(id), do: Repo.get(Recording, id)

  def create_recording(attrs) do
    %Recording{}
    |> Recording.create_changeset(attrs)
    |> validate_parent_exists()
    |> Repo.insert()
  end

  # SQLite reports FK violations without a constraint name, which Ecto can't map
  # back to a changeset error — so check explicitly for a clean 422.
  defp validate_parent_exists(changeset) do
    Ecto.Changeset.validate_change(changeset, :parent_id, fn :parent_id, parent_id ->
      if Repo.exists?(from r in Recording, where: r.id == ^parent_id),
        do: [],
        else: [parent_id: "does not exist"]
    end)
  end

  def update_recording(%Recording{} = recording, attrs) do
    recording |> Recording.update_changeset(attrs) |> Repo.update()
  end

  def delete_recording(%Recording{} = recording), do: Repo.delete(recording)

  @doc "Whole audio blob for `id`, or nil."
  def read_audio(id) do
    Repo.one(from r in Recording, where: r.id == ^id, select: r.audio)
  end

  @doc """
  `length` bytes of the blob starting at 0-based `offset`. Done in SQL
  (`substr` on a BLOB is byte-based) so a Range request for the last few KB of a
  20 MB take doesn't load all 20 MB into the BEAM first.
  """
  def read_audio_slice(id, offset, length) when offset >= 0 and length > 0 do
    Repo.one(
      from r in Recording,
        where: r.id == ^id,
        select: fragment("substr(?, ?, ?)", r.audio, ^(offset + 1), ^length)
    )
  end

  @doc "Store a transcript/summary (and, if the title is still the default, a better title)."
  def save_transcript(%Recording{} = recording, %{transcript: t, summary: s, title: title}) do
    attrs = %{transcript: t, summary: s}

    attrs =
      if recording.title in ["Untitled recording", ""] or
           String.starts_with?(recording.title, "Recording "),
         do: Map.put(attrs, :title, title),
         else: attrs

    update_recording(recording, attrs)
  end
end
