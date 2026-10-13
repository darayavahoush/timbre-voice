defmodule Timbre.Sessions do
  @moduledoc """
  Multiplayer sessions: a shared link (`/s/<id>`) that several browsers join.
  The durable bits (the link, who the host is, the resulting mix) live in the
  `sessions` table; the live audio lives in a `Timbre.Sessions.Room` process.
  """
  import Ecto.Query, warn: false

  alias Timbre.Repo
  alias Timbre.Sessions.{Room, Session}

  @doc "Creates a session. Returns the one-time plaintext `host_token` too."
  def create_session(attrs) do
    id = random_token(6)
    host_token = random_token(24)

    changeset =
      Session.create_changeset(
        %Session{id: id, host_token_hash: hash(host_token)},
        attrs
      )

    with {:ok, session} <- Repo.insert(changeset), do: {:ok, session, host_token}
  end

  def get_session(id) when is_binary(id), do: Repo.get(Session, id)

  def fetch(id) do
    case get_session(id) do
      nil -> {:error, :not_found}
      session -> {:ok, session}
    end
  end

  @doc "Constant-time check of a host token against the stored hash."
  def host?(%Session{host_token_hash: stored}, token) when is_binary(token) and token != "" do
    Plug.Crypto.secure_compare(hash(token), stored)
  end

  def host?(_session, _token), do: false

  def mark_finished(session_id, recording_id) do
    from(s in Session, where: s.id == ^session_id)
    |> Repo.update_all(
      set: [status: "finished", recording_id: recording_id, finished_at: now(), updated_at: now()]
    )

    :ok
  end

  @doc """
  Joins the live room for `session` (starting it if needed).
  Returns `{:ok, %{participant_id, state}}`, `{:error, :finished, recording_id}` or `{:error, :full}`.
  """
  def join(%Session{status: "finished"} = session, _client_id, _name, _host?) do
    {:error, :finished, session.recording_id}
  end

  def join(%Session{} = session, client_id, name, host?) do
    with {:ok, _pid} <- ensure_room(session),
         do: Room.join(session.id, client_id, name, host?, self())
  end

  def ensure_room(%Session{id: id}) do
    case DynamicSupervisor.start_child(Timbre.Sessions.RoomSupervisor, {Room, id}) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      other -> other
    end
  end

  defp hash(token), do: :crypto.hash(:sha256, token) |> Base.encode16(case: :lower)

  defp random_token(bytes),
    do: bytes |> :crypto.strong_rand_bytes() |> Base.url_encode64(padding: false)

  defp now, do: DateTime.utc_now() |> DateTime.truncate(:second)
end
