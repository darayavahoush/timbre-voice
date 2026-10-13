defmodule TimbreWeb.RecordingJSON do
  alias Timbre.Recordings.Recording

  def index(%{recordings: recordings}), do: %{data: Enum.map(recordings, &data/1)}
  def show(%{recording: recording}), do: %{data: data(recording)}

  def data(%Recording{} = r) do
    %{
      id: r.id,
      title: r.title,
      kind: r.kind,
      mime_type: r.mime_type,
      duration_ms: r.duration_ms,
      byte_size: r.byte_size,
      sample_rate: r.sample_rate,
      parent_id: r.parent_id,
      effects: r.effects,
      transcript: r.transcript,
      summary: r.summary,
      inserted_at: r.inserted_at,
      audio_url: "/api/recordings/#{r.id}/audio"
    }
  end
end
