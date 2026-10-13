defmodule TimbreWeb.SessionJSON do
  alias Timbre.Sessions.Session

  def show(%{session: session} = assigns) do
    data = data(session)
    data = if token = assigns[:host_token], do: Map.put(data, :host_token, token), else: data
    %{data: data}
  end

  def data(%Session{} = s) do
    %{
      id: s.id,
      name: s.name,
      status: s.status,
      recording_id: s.recording_id,
      inserted_at: s.inserted_at
    }
  end
end
