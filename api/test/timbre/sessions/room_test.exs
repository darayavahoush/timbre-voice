defmodule Timbre.Sessions.RoomTest do
  use Timbre.DataCase, async: false

  alias Timbre.{Recordings, Sessions}
  alias Timbre.Sessions.Room

  @rate Room.sample_rate()

  setup do
    {:ok, session, token} = Sessions.create_session(%{"name" => "Standup"})
    Phoenix.PubSub.subscribe(Timbre.PubSub, "session:" <> session.id)
    {:ok, session: session, token: token}
  end

  defp join_room(session, client_id, name, host? \\ false, pid \\ self()) do
    {:ok, _} = Sessions.ensure_room(session)
    Room.join(session.id, client_id, name, host?, pid)
  end

  defp pcm(sample, count), do: :binary.copy(<<sample::little-signed-16>>, count)
  defp started_ms(id), do: :sys.get_state(Room.via(id)).started_ms

  defp wav_samples(wav) do
    <<_::binary-size(44), data::binary>> = wav
    for <<s::little-signed-16 <- data>>, do: s
  end

  test "host token is checked in constant time against the stored hash", %{session: s, token: t} do
    assert Sessions.host?(s, t)
    refute Sessions.host?(s, "nope")
    refute Sessions.host?(s, nil)
    refute s.host_token_hash == t
  end

  test "join broadcasts a roster and returns a stable public id", %{session: s} do
    assert {:ok, %{participant_id: id, state: %{status: "open"}}} =
             join_room(s, "client-aaaaaaaa", "Ann", true)

    assert id == Room.short_id("client-aaaaaaaa")
    assert byte_size(id) == 8

    assert_receive %Phoenix.Socket.Broadcast{
      event: "roster",
      payload: %{participants: [%{name: "Ann", host: true, live: true}]}
    }
  end

  test "only whole takes: audio before start is ignored, start can't be repeated", %{session: s} do
    {:ok, _} = join_room(s, "client-aaaaaaaa", "Ann", true)
    Room.push_audio(s.id, "client-aaaaaaaa", pcm(500, 160), 0)
    assert :ok = Room.start_recording(s.id)
    assert {:error, :bad_state} = Room.start_recording(s.id)
    assert {:error, :nothing_recorded} = Room.stop_recording(s.id)
    assert Recordings.list_recordings() == []
  end

  test "mixes participants at their start offsets and saves one WAV", %{session: s} do
    {:ok, _} = join_room(s, "client-aaaaaaaa", "Ann", true)
    {:ok, _} = join_room(s, "client-bbbbbbbb", "Bob")
    :ok = Room.start_recording(s.id)
    t0 = started_ms(s.id)

    # Ann: 0.1 s of 8000, first chunk arrives 100 ms after start (captured at 0)
    Room.push_audio(s.id, "client-aaaaaaaa", pcm(8000, 1600), t0 + 100)
    # Bob: speaks from 0.2 s; two chunks, 0.1 s each
    Room.push_audio(s.id, "client-bbbbbbbb", pcm(4000, 1600), t0 + 300)
    Room.push_audio(s.id, "client-bbbbbbbb", pcm(4000, 1600), t0 + 400)
    # a stranger and oversized/odd chunks are ignored
    Room.push_audio(s.id, "client-zzzzzzzz", pcm(9999, 1600), t0 + 100)
    Room.push_audio(s.id, "client-aaaaaaaa", <<1>>, t0 + 450)
    Room.push_audio(s.id, "client-aaaaaaaa", :binary.copy(<<0>>, 70_000), t0 + 450)

    assert {:ok, recording} = Room.stop_recording(s.id)
    assert recording.kind == "mix"
    assert recording.mime_type == "audio/wav"
    assert recording.duration_ms == 400
    assert recording.sample_rate == @rate
    assert recording.title == "Standup (mix)"
    assert recording.effects["participants"] |> Enum.sort() == ["Ann", "Bob"]

    samples = recording.id |> Recordings.read_audio() |> wav_samples()
    assert length(samples) == 6400
    s2 = 1 / :math.sqrt(2)
    assert Enum.at(samples, 0) == round(8000 * s2)
    assert Enum.at(samples, 1599) == round(8000 * s2)
    assert Enum.at(samples, 1600) == 0
    assert Enum.at(samples, 3200) == round(4000 * s2)
    assert Enum.at(samples, 6399) == round(4000 * s2)

    assert_receive %Phoenix.Socket.Broadcast{event: "finished", payload: %{recording_id: id}}
    assert id == recording.id
    assert Sessions.get_session(s.id).status == "finished"
    assert Sessions.get_session(s.id).recording_id == recording.id
  end

  test "a finished session can't be joined again", %{session: s} do
    {:ok, _} = join_room(s, "client-aaaaaaaa", "Ann", true)
    :ok = Room.start_recording(s.id)
    Room.push_audio(s.id, "client-aaaaaaaa", pcm(1, 1600), started_ms(s.id) + 100)
    {:ok, _} = Room.stop_recording(s.id)

    assert {:error, :finished, _} =
             Sessions.join(Sessions.get_session(s.id), "client-bbbbbbbb", "Bob", false)

    assert {:error, :bad_state} = Room.stop_recording(s.id)
  end

  test "caps the number of participants but lets known clients reconnect", %{session: s} do
    for i <- 1..8, do: {:ok, _} = join_room(s, "client-#{i}-xxxxxxxx", "P#{i}")
    assert {:error, :full} = join_room(s, "client-9-xxxxxxxx", "P9")
    assert {:ok, _} = join_room(s, "client-3-xxxxxxxx", "P3 again")
  end

  test "reconnecting keeps the participant's track", %{session: s} do
    first = spawn(fn -> Process.sleep(:infinity) end)
    {:ok, _} = join_room(s, "client-aaaaaaaa", "Ann", true, first)
    :ok = Room.start_recording(s.id)
    t0 = started_ms(s.id)
    Room.push_audio(s.id, "client-aaaaaaaa", pcm(1000, 1600), t0 + 100)

    ref = Process.monitor(first)
    Process.exit(first, :kill)
    assert_receive {:DOWN, ^ref, _, _, _}

    assert_receive %Phoenix.Socket.Broadcast{
      event: "roster",
      payload: %{participants: [%{live: false}]}
    }

    {:ok, _} = join_room(s, "client-aaaaaaaa", "Ann")
    Room.push_audio(s.id, "client-aaaaaaaa", pcm(1000, 1600), t0 + 200)
    {:ok, recording} = Room.stop_recording(s.id)
    assert recording.duration_ms == 200
  end

  test "an abandoned take is saved, then the room shuts down", %{session: s} do
    Application.put_env(:timbre, :room_idle_ms, 30)
    on_exit(fn -> Application.delete_env(:timbre, :room_idle_ms) end)

    {:ok, _} = Sessions.ensure_room(s) |> then(fn r -> r end)
    # restart with the short idle timeout
    [{room, _}] = Registry.lookup(Timbre.Sessions.Registry, s.id)
    ref = Process.monitor(room)
    DynamicSupervisor.terminate_child(Timbre.Sessions.RoomSupervisor, room)
    assert_receive {:DOWN, ^ref, _, _, _}

    channel = spawn(fn -> Process.sleep(:infinity) end)
    {:ok, _} = join_room(s, "client-aaaaaaaa", "Ann", true, channel)
    [{room, _}] = Registry.lookup(Timbre.Sessions.Registry, s.id)
    ref = Process.monitor(room)

    :ok = Room.start_recording(s.id)
    Room.push_audio(s.id, "client-aaaaaaaa", pcm(1000, 1600), started_ms(s.id) + 100)
    Process.exit(channel, :kill)

    assert_receive {:DOWN, ^ref, _, _, :normal}, 2_000
    assert [%{kind: "mix"}] = Recordings.list_recordings()
    assert Sessions.get_session(s.id).status == "finished"
  end
end
