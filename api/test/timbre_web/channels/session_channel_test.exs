defmodule TimbreWeb.SessionChannelTest do
  use TimbreWeb.ChannelCase, async: false

  alias Timbre.{Recordings, Sessions}
  alias TimbreWeb.{SessionChannel, UserSocket}

  setup do
    {:ok, session, token} = Sessions.create_session(%{"name" => "Room"})
    {:ok, session: session, token: token}
  end

  defp join_as(session, params) do
    {:ok, reply, socket} =
      UserSocket
      |> socket(nil, %{})
      |> subscribe_and_join(SessionChannel, "session:" <> session.id, params)

    {reply, socket}
  end

  defp host(session, token),
    do:
      join_as(session, %{
        "client_id" => "host-client-0001",
        "name" => "Hana",
        "host_token" => token
      })

  defp guest(session, n \\ 1),
    do: join_as(session, %{"client_id" => "guest-client-000#{n}", "name" => "Gus"})

  defp chunk(sample, count \\ 1600), do: :binary.copy(<<sample::little-signed-16>>, count)

  test "the host token makes you host; a link alone does not", %{session: s, token: t} do
    {reply, _} = host(s, t)
    assert reply.host and reply.sample_rate == 16_000 and reply.state.status == "open"
    {reply, _} = guest(s)
    refute reply.host
  end

  test "rejects unknown sessions and bad client ids", %{session: s} do
    assert {:error, %{reason: "not_found"}} =
             UserSocket
             |> socket(nil, %{})
             |> subscribe_and_join(SessionChannel, "session:nope", %{
               "client_id" => "x" |> String.duplicate(10)
             })

    assert {:error, %{reason: "bad_request"}} =
             UserSocket
             |> socket(nil, %{})
             |> subscribe_and_join(SessionChannel, "session:" <> s.id, %{"client_id" => "x"})
  end

  test "only the host can start and stop", %{session: s, token: t} do
    {_, host_socket} = host(s, t)
    {_, guest_socket} = guest(s)

    ref = push(guest_socket, "start", %{})
    assert_reply ref, :error, %{reason: "host_only"}
    ref = push(guest_socket, "stop", %{})
    assert_reply ref, :error, %{reason: "host_only"}

    ref = push(host_socket, "start", %{})
    assert_reply ref, :ok
    assert_push "state", %{status: "recording"}
  end

  test "full take: guests stream, host stops, a mix is saved", %{session: s, token: t} do
    {_, host_socket} = host(s, t)
    {_, guest_socket} = guest(s)

    ref = push(host_socket, "start", %{})
    assert_reply ref, :ok
    assert_push "state", %{status: "recording"}

    push(host_socket, "audio", {:binary, chunk(6000)})
    push(guest_socket, "audio", {:binary, chunk(3000)})
    # make sure both casts have reached the room before stopping
    _ = :sys.get_state(Timbre.Sessions.Room.via(s.id))

    ref = push(host_socket, "stop", %{})
    assert_reply ref, :ok, %{recording_id: id}, 10_000
    assert_push "finished", %{recording_id: ^id}

    recording = Recordings.get_recording(id)
    assert recording.kind == "mix"
    assert recording.effects["tracks"] == 2
    assert recording.byte_size > 44
  end

  test "live relay only reaches listeners, and never echoes to the sender", %{
    session: s,
    token: t
  } do
    {_, host_socket} = host(s, t)
    {_, guest_socket} = guest(s)

    ref = push(host_socket, "start", %{})
    assert_reply ref, :ok
    assert_push "state", %{status: "recording"}

    pcm = chunk(1234, 100)
    push(guest_socket, "audio", {:binary, pcm})
    refute_push "audio", _, 100

    ref = push(host_socket, "listen", %{"on" => true})
    assert_reply ref, :ok
    push(guest_socket, "audio", {:binary, pcm})
    guest_id = Timbre.Sessions.Room.short_id("guest-client-0001")
    assert_push "audio", {:binary, <<^guest_id::binary-size(8), ^pcm::binary>>}

    # the sender isn't a listener of their own stream: only the host's copy arrives
    ref = push(guest_socket, "listen", %{"on" => true})
    assert_reply ref, :ok
    push(guest_socket, "audio", {:binary, pcm})
    assert_push "audio", {:binary, <<^guest_id::binary-size(8), _::binary>>}
    refute_push "audio", _, 100
  end

  test "audio sent outside a take is dropped, not relayed", %{session: s, token: t} do
    {_, host_socket} = host(s, t)
    {_, guest_socket} = guest(s)
    ref = push(host_socket, "listen", %{"on" => true})
    assert_reply ref, :ok
    push(guest_socket, "audio", {:binary, chunk(1)})
    refute_push "audio", _, 100
  end

  test "levels are fanned out to the others", %{session: s, token: t} do
    {_, _host_socket} = host(s, t)
    {_, guest_socket} = guest(s)
    push(guest_socket, "level", %{"v" => 5})
    id = Timbre.Sessions.Room.short_id("guest-client-0001")
    assert_push "level", %{id: ^id, v: 1}
  end

  test "joining a finished session reports the recording", %{session: s, token: t} do
    {_, host_socket} = host(s, t)
    ref = push(host_socket, "start", %{})
    assert_reply ref, :ok
    assert_push "state", %{status: "recording"}
    push(host_socket, "audio", {:binary, chunk(100)})
    ref = push(host_socket, "stop", %{})
    assert_reply ref, :ok, %{recording_id: id}, 10_000

    assert {:error, %{reason: "finished", recording_id: ^id}} =
             UserSocket
             |> socket(nil, %{})
             |> subscribe_and_join(SessionChannel, "session:" <> s.id, %{
               "client_id" => "late-client-0001"
             })
  end
end
