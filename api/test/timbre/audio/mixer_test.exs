defmodule Timbre.Audio.MixerTest do
  use ExUnit.Case, async: true

  alias Timbre.Audio.Mixer

  defp pcm(ints), do: for(i <- ints, into: <<>>, do: <<i::little-signed-16>>)
  defp ints(bin), do: for(<<s::little-signed-16 <- bin>>, do: s)

  test "no tracks -> empty mix" do
    assert Mixer.mix([]) == {<<>>, 0}
    assert Mixer.mix([%{offset: 5, pcm: <<>>}]) == {<<>>, 0}
  end

  test "a single track passes through untouched (no attenuation)" do
    samples = [0, 100, -100, 32_767, -32_768]
    {out, n} = Mixer.mix([%{offset: 0, pcm: pcm(samples)}])
    assert n == 5
    assert ints(out) == samples
  end

  test "two tracks sum with 1/sqrt(2) headroom" do
    a = %{offset: 0, pcm: pcm([10_000, 10_000])}
    b = %{offset: 0, pcm: pcm([10_000, -10_000])}
    {out, 2} = Mixer.mix([a, b])
    assert ints(out) == [round(20_000 / :math.sqrt(2)), 0]
  end

  test "offsets place tracks on the timeline; gaps are silence" do
    a = %{offset: 0, pcm: pcm([1000, 1000])}
    b = %{offset: 4, pcm: pcm([2000])}
    {out, n} = Mixer.mix([a, b])
    assert n == 5
    s = 1 / :math.sqrt(2)
    assert ints(out) == [round(1000 * s), round(1000 * s), 0, 0, round(2000 * s)]
  end

  test "clips instead of wrapping" do
    t = %{offset: 0, pcm: pcm([32_767, -32_768])}
    {out, _} = Mixer.mix([t, t])
    assert ints(out) == [32_767, -32_768]
  end

  test "an odd trailing byte is ignored" do
    {out, n} = Mixer.mix([%{offset: 0, pcm: pcm([5, 6]) <> <<9>>}])
    assert n == 2
    assert ints(out) == [5, 6]
  end

  test "matches a naive reference across block boundaries" do
    a = for i <- 1..40_000, do: rem(i * 7, 20_000) - 10_000
    b = for i <- 1..25_000, do: rem(i * 13, 16_000) - 8_000
    c = for i <- 1..9_000, do: rem(i * 3, 6_000) - 3_000

    tracks = [
      %{offset: 0, pcm: pcm(a)},
      %{offset: 15_990, pcm: pcm(b)},
      %{offset: 31_000, pcm: pcm(c)}
    ]

    {out, n} = Mixer.mix(tracks)
    assert n == 40_990

    at = fn list, offset, i ->
      idx = i - offset
      if idx >= 0 and idx < length(list), do: Enum.at(list, idx), else: 0
    end

    # spot-check a spread of positions, including both block edges
    for i <- [0, 1, 15_989, 15_990, 15_999, 16_000, 16_001, 31_000, 31_999, 32_000, 39_999] do
      expected =
        ([at.(a, 0, i), at.(b, 15_990, i), at.(c, 31_000, i)] |> Enum.sum()) / :math.sqrt(3)

      assert Enum.at(ints(out), i) == round(expected), "sample #{i}"
    end
  end

  test "mixing a few minutes of audio is fast enough to run inline" do
    # 3 participants x 60 s @16 kHz
    track = %{offset: 0, pcm: :binary.copy(<<1, 2>>, 16_000 * 60)}
    {micros, {_, n}} = :timer.tc(fn -> Mixer.mix([track, track, track]) end)
    assert n == 960_000
    assert micros < 8_000_000
  end
end
