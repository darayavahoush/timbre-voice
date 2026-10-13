defmodule Timbre.Sessions.Room do
  @moduledoc """
  The live side of a session: one process per active session that collects each
  participant's PCM stream and, when the host stops the take, mixes everything
  into a single recording.

  ## Audio contract
  Clients stream mono, 16 kHz, signed 16-bit little-endian PCM in small chunks
  (~128 ms) over the channel, *contiguously* — a muted client sends zeros rather
  than nothing. That keeps every track a gap-free timeline, so aligning tracks
  only needs each participant's start offset, estimated from when their first
  chunk reaches the server (relative to the host pressing record). Phoenix's JS
  client buffers pushes during a reconnect, so a flaky link delays audio instead
  of punching holes in it.

  Everything is in memory while recording (~1.9 MB per participant-minute) and
  bounded by `@max_samples`; the finished mix is written to the database.
  """
  use GenServer, restart: :temporary

  alias Timbre.{Recordings, Sessions}
  alias Timbre.Audio.{Mixer, Wav}

  @sample_rate 16_000
  @max_participants 8
  @max_chunk_bytes 65_536
  # 30 minutes per track
  @max_samples @sample_rate * 60 * 30
  @idle_ms 60_000

  def sample_rate, do: @sample_rate
  def now_ms, do: System.monotonic_time(:millisecond)

  ## Client API (all take the session id)

  def start_link(session_id),
    do: GenServer.start_link(__MODULE__, session_id, name: via(session_id))

  def via(id), do: {:via, Registry, {Timbre.Sessions.Registry, id}}

  @doc "Public participant id used to tag relayed audio frames (stable per client)."
  def short_id(client_id) do
    :crypto.hash(:sha256, client_id) |> binary_part(0, 4) |> Base.encode16(case: :lower)
  end

  def join(id, client_id, name, host?, channel_pid),
    do: GenServer.call(via(id), {:join, client_id, name, host?, channel_pid})

  def start_recording(id), do: GenServer.call(via(id), :start)
  def stop_recording(id), do: GenServer.call(via(id), :stop, 120_000)

  @doc "Fire-and-forget: append a PCM chunk to the participant's track."
  def push_audio(id, client_id, pcm, arrival_ms \\ now_ms()) when is_binary(pcm),
    do: GenServer.cast(via(id), {:audio, client_id, pcm, arrival_ms})

  def snapshot(id), do: GenServer.call(via(id), :snapshot)

  ## Server

  @impl true
  def init(session_id) do
    {:ok,
     %{
       id: session_id,
       status: :open,
       started_ms: nil,
       participants: %{},
       idle_timer: nil,
       idle_ms: Application.get_env(:timbre, :room_idle_ms, @idle_ms)
     }}
  end

  @impl true
  def handle_call({:join, client_id, name, host?, pid}, _from, state) do
    existing = state.participants[client_id]

    cond do
      state.status == :finished ->
        {:reply, {:error, :finished, nil}, state}

      is_nil(existing) and map_size(state.participants) >= @max_participants ->
        {:reply, {:error, :full}, state}

      true ->
        if existing && existing.ref, do: Process.demonitor(existing.ref, [:flush])
        ref = Process.monitor(pid)

        participant = %{
          id: short_id(client_id),
          name: name,
          host: host?,
          pid: pid,
          ref: ref,
          track: existing && existing.track
        }

        state =
          state
          |> put_in([:participants, client_id], participant)
          |> cancel_idle()

        broadcast_roster(state)
        {:reply, {:ok, %{participant_id: participant.id, state: public_state(state)}}, state}
    end
  end

  def handle_call(:start, _from, %{status: :open} = state) do
    state = %{state | status: :recording, started_ms: now_ms()}
    broadcast(state.id, "state", public_state(state))
    {:reply, :ok, state}
  end

  def handle_call(:start, _from, state), do: {:reply, {:error, :bad_state}, state}

  def handle_call(:stop, _from, %{status: :recording} = state) do
    case finalize(state) do
      {:ok, recording, state} -> {:reply, {:ok, recording}, state}
      {:error, reason, state} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call(:stop, _from, state), do: {:reply, {:error, :bad_state}, state}
  def handle_call(:snapshot, _from, state), do: {:reply, public_state(state), state}

  @impl true
  def handle_cast({:audio, client_id, pcm, arrival_ms}, %{status: :recording} = state) do
    with %{} = p <- state.participants[client_id],
         true <- byte_size(pcm) in 2..@max_chunk_bytes,
         track = append(p.track, pcm, arrival_ms, state.started_ms),
         true <- track.samples <= @max_samples do
      {:noreply, put_in(state, [:participants, client_id, :track], track)}
    else
      _ -> {:noreply, state}
    end
  end

  # Audio outside a take (or from strangers) is dropped.
  def handle_cast({:audio, _, _, _}, state), do: {:noreply, state}

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, _reason}, state) do
    participants =
      Map.new(state.participants, fn
        {cid, %{ref: ^ref} = p} -> {cid, %{p | pid: nil, ref: nil}}
        other -> other
      end)

    state = %{state | participants: participants}
    broadcast_roster(state)
    {:noreply, if(live_count(state) == 0, do: schedule_idle(state), else: state)}
  end

  # Nobody has been connected for a while: save a take in progress rather than
  # lose it, otherwise just free the room.
  def handle_info(:idle, %{status: :recording} = state) do
    if live_count(state) == 0 do
      case finalize(state) do
        {:ok, _recording, state} -> {:noreply, schedule_idle(state)}
        {:error, _reason, state} -> {:stop, :normal, state}
      end
    else
      {:noreply, state}
    end
  end

  def handle_info(:idle, state) do
    if live_count(state) == 0, do: {:stop, :normal, state}, else: {:noreply, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  ## Internals

  defp append(nil, pcm, arrival_ms, started_ms) do
    chunk_samples = div(byte_size(pcm), 2)
    capture_start_ms = arrival_ms - started_ms - chunk_samples * 1000 / @sample_rate

    %{
      offset: max(round(capture_start_ms * @sample_rate / 1000), 0),
      chunks: [pcm],
      samples: chunk_samples
    }
  end

  defp append(track, pcm, _arrival_ms, _started_ms) do
    %{track | chunks: [pcm | track.chunks], samples: track.samples + div(byte_size(pcm), 2)}
  end

  defp finalize(state) do
    tracks =
      for {_cid, %{track: %{} = t}} <- state.participants do
        %{offset: t.offset, pcm: t.chunks |> Enum.reverse() |> IO.iodata_to_binary()}
      end

    {pcm, samples} = Mixer.mix(tracks)

    if samples == 0 do
      # Nothing was spoken: let the host try again instead of saving an empty file.
      state = %{state | status: :open, started_ms: nil}
      broadcast(state.id, "state", public_state(state))
      {:error, :nothing_recorded, state}
    else
      session = Sessions.get_session(state.id)
      names = for {_cid, %{track: %{}, name: n}} <- state.participants, do: n

      attrs = %{
        "title" => "#{session.name} (mix)",
        "kind" => "mix",
        "mime_type" => "audio/wav",
        "audio" => Wav.encode(pcm, @sample_rate),
        "duration_ms" => Wav.duration_ms(samples, @sample_rate),
        "sample_rate" => @sample_rate,
        "effects" => %{"participants" => names, "tracks" => length(tracks)}
      }

      case Recordings.create_recording(attrs) do
        {:ok, recording} ->
          Sessions.mark_finished(state.id, recording.id)
          state = %{state | status: :finished}
          broadcast(state.id, "finished", %{recording_id: recording.id})
          broadcast(state.id, "state", public_state(state, recording.id))
          {:ok, recording, state}

        {:error, _changeset} ->
          {:error, :save_failed, state}
      end
    end
  end

  defp public_state(state, recording_id \\ nil) do
    %{
      status: Atom.to_string(state.status),
      recording_id: recording_id,
      participants: roster(state)
    }
  end

  defp roster(state) do
    state.participants
    |> Map.values()
    |> Enum.sort_by(& &1.id)
    |> Enum.map(&%{id: &1.id, name: &1.name, host: &1.host, live: &1.pid != nil})
  end

  defp live_count(state), do: Enum.count(state.participants, fn {_, p} -> p.pid != nil end)

  defp broadcast_roster(state), do: broadcast(state.id, "roster", %{participants: roster(state)})

  defp broadcast(id, event, payload),
    do: Phoenix.Channel.Server.broadcast(Timbre.PubSub, "session:" <> id, event, payload)

  defp schedule_idle(state) do
    state = cancel_idle(state)
    %{state | idle_timer: Process.send_after(self(), :idle, state.idle_ms)}
  end

  defp cancel_idle(%{idle_timer: nil} = state), do: state

  defp cancel_idle(%{idle_timer: ref} = state) do
    Process.cancel_timer(ref)
    %{state | idle_timer: nil}
  end
end
