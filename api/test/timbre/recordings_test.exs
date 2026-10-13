defmodule Timbre.RecordingsTest do
  use Timbre.DataCase, async: false

  alias Timbre.Recordings

  @audio :crypto.strong_rand_bytes(2048)

  defp attrs(extra \\ %{}) do
    Map.merge(
      %{"audio" => @audio, "mime_type" => "audio/webm;codecs=opus", "title" => "Take 1"},
      extra
    )
  end

  test "creates a recording, normalising the mime type and computing the size" do
    assert {:ok, r} = Recordings.create_recording(attrs(%{"duration_ms" => "1500"}))
    assert r.mime_type == "audio/webm"
    assert r.byte_size == 2048
    assert r.duration_ms == 1500
    assert r.kind == "original"
  end

  test "blank title gets a default" do
    assert {:ok, r} = Recordings.create_recording(attrs(%{"title" => "   "}))
    assert r.title == "Untitled recording"
  end

  test "rejects non-audio, empty and unknown-kind uploads" do
    assert {:error, cs} = Recordings.create_recording(attrs(%{"mime_type" => "image/png"}))
    assert %{mime_type: [_]} = errors_on(cs)

    assert {:error, cs} = Recordings.create_recording(attrs(%{"audio" => ""}))
    assert %{audio: _} = errors_on(cs)

    assert {:error, cs} = Recordings.create_recording(attrs(%{"kind" => "bogus"}))
    assert %{kind: _} = errors_on(cs)
  end

  test "rejects audio over the size cap" do
    big = :binary.copy(<<0>>, Timbre.Recordings.Recording.max_bytes() + 1)
    assert {:error, cs} = Recordings.create_recording(attrs(%{"audio" => big}))
    assert %{audio: [msg]} = errors_on(cs)
    assert msg =~ "too large"
  end

  test "listing never loads the audio blob; newest first" do
    {:ok, a} = Recordings.create_recording(attrs(%{"title" => "a"}))
    {:ok, b} = Recordings.create_recording(attrs(%{"title" => "b"}))
    list = Recordings.list_recordings()
    assert Enum.map(list, & &1.id) == [b.id, a.id]
    assert Enum.all?(list, &is_nil(&1.audio))
  end

  test "reads whole blob and byte slices" do
    {:ok, r} = Recordings.create_recording(attrs())
    assert Recordings.read_audio(r.id) == @audio
    assert Recordings.read_audio_slice(r.id, 0, 10) == binary_part(@audio, 0, 10)
    assert Recordings.read_audio_slice(r.id, 100, 50) == binary_part(@audio, 100, 50)
    assert Recordings.read_audio_slice(r.id, 2040, 8) == binary_part(@audio, 2040, 8)
    assert Recordings.read_audio(-1) == nil
  end

  test "deleting an original keeps its processed takes (parent is nilified)" do
    {:ok, parent} = Recordings.create_recording(attrs())

    {:ok, child} =
      Recordings.create_recording(attrs(%{"kind" => "processed", "parent_id" => parent.id}))

    assert {:ok, _} = Recordings.delete_recording(parent)
    assert Recordings.get_recording(child.id).parent_id == nil
  end

  test "bad parent_id is a validation error, not a crash" do
    assert {:error, cs} = Recordings.create_recording(attrs(%{"parent_id" => 9999}))
    assert %{parent_id: _} = errors_on(cs)
  end

  def errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
