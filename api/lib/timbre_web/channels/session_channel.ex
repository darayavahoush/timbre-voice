defmodule TimbreWeb.SessionChannel do
  @moduledoc """
  Realtime side of a multiplayer session (`session:<id>`).

  Client -> server
    * `"audio"` — binary PCM16LE mono @16 kHz chunk (only stored during a take)
    * `"level"` — `%{"v" => 0..1}` meter value for the others' UI
    * `"listen"` — `%{"on" => bool}` opt in to live relay of the others' audio
    * `"start"` / `"stop"` — host only; `stop` replies with the saved recording id

  Server -> client
    * `"state"` — `%{status, recording_id, participants}`; `"roster"`; `"finished"`
    * `"audio"` — binary `<<participant_id::8-bytes, pcm::binary>>` (listeners only)
    * `"level"` — `%{id, v}`
  """
  use TimbreWeb, :channel

  alias Timbre.Sessions
  alias Timbre.Sessions.Room

  # Filter per socket: audio only reaches listeners; state is mirrored into assigns.
  intercept ["audio", "state"]

  @impl true
  def join("session:" <> id, params, socket) do
    with {:ok, session} <- Sessions.fetch(id),
         {:ok, client_id} <- fetch_client_id(params),
         host? = Sessions.host?(session, params["host_token"]),
         {:ok, info} <- Sessions.join(session, client_id, display_name(params), host?) do
      socket =
        assign(socket,
          session_id: id,
          client_id: client_id,
          participant_id: info.participant_id,
          host?: host?,
          listening: false,
          status: info.state.status
        )

      reply = %{
        participant_id: info.participant_id,
        host: host?,
        sample_rate: Room.sample_rate(),
        state: info.state
      }

      {:ok, reply, socket}
    else
      {:error, :not_found} ->
        {:error, %{reason: "not_found"}}

      {:error, :finished, recording_id} ->
        {:error, %{reason: "finished", recording_id: recording_id}}

      {:error, :full} ->
        {:error, %{reason: "full"}}

      {:error, :bad_client} ->
        {:error, %{reason: "bad_request"}}
    end
  end

  @impl true
  def handle_in("audio", {:binary, pcm}, %{assigns: %{status: "recording"}} = socket) do
    a = socket.assigns
    Room.push_audio(a.session_id, a.client_id, pcm)
    broadcast_from!(socket, "audio", {:binary, <<a.participant_id::binary-size(8), pcm::binary>>})
    {:noreply, socket}
  end

  def handle_in("audio", _payload, socket), do: {:noreply, socket}

  def handle_in("level", %{"v" => v}, socket) when is_number(v) do
    broadcast_from!(socket, "level", %{id: socket.assigns.participant_id, v: min(max(v, 0), 1)})
    {:noreply, socket}
  end

  def handle_in("listen", %{"on" => on}, socket) when is_boolean(on) do
    {:reply, :ok, assign(socket, :listening, on)}
  end

  def handle_in("start", _payload, %{assigns: %{host?: true}} = socket) do
    case Room.start_recording(socket.assigns.session_id) do
      :ok -> {:reply, :ok, socket}
      {:error, reason} -> {:reply, {:error, %{reason: to_string(reason)}}, socket}
    end
  end

  def handle_in("stop", _payload, %{assigns: %{host?: true}} = socket) do
    case Room.stop_recording(socket.assigns.session_id) do
      {:ok, recording} -> {:reply, {:ok, %{recording_id: recording.id}}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: to_string(reason)}}, socket}
    end
  end

  def handle_in(event, _payload, socket) when event in ["start", "stop"],
    do: {:reply, {:error, %{reason: "host_only"}}, socket}

  def handle_in(_event, _payload, socket), do: {:noreply, socket}

  @impl true
  def handle_out("audio", payload, %{assigns: %{listening: true}} = socket) do
    push(socket, "audio", payload)
    {:noreply, socket}
  end

  def handle_out("audio", _payload, socket), do: {:noreply, socket}

  def handle_out("state", payload, socket) do
    push(socket, "state", payload)
    {:noreply, assign(socket, :status, payload.status)}
  end

  defp fetch_client_id(%{"client_id" => id}) when is_binary(id) and byte_size(id) in 8..64,
    do: {:ok, id}

  defp fetch_client_id(_), do: {:error, :bad_client}

  defp display_name(%{"name" => name}) when is_binary(name) do
    case name |> String.trim() |> String.slice(0, 32) do
      "" -> "Guest"
      trimmed -> trimmed
    end
  end

  defp display_name(_), do: "Guest"
end
