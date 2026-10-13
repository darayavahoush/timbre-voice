defmodule Timbre.Audio.Mixer do
  @moduledoc """
  Sums several mono 16-bit PCM tracks (same sample rate) into one.

  Each track is `%{offset: samples_from_start, pcm: binary}`. The mix is as long
  as the latest-ending track. Tracks are summed and scaled by `1/sqrt(n)` — the
  right headroom for uncorrelated sources such as different people talking — and
  hard-clamped to the int16 range as a last resort.

  Work is done in one-second blocks so memory stays flat for long sessions.
  """

  @block 16_000
  @max 32_767
  @min -32_768

  @type track :: %{offset: non_neg_integer(), pcm: binary()}

  @doc "Returns `{pcm, sample_count}`."
  @spec mix([track()]) :: {binary(), non_neg_integer()}
  def mix(tracks) do
    tracks =
      for %{offset: offset, pcm: pcm} <- tracks, byte_size(pcm) >= 2 do
        # drop a trailing odd byte so we only ever deal in whole samples
        %{offset: offset, pcm: binary_part(pcm, 0, byte_size(pcm) - rem(byte_size(pcm), 2))}
      end

    total = tracks |> Enum.map(&(&1.offset + div(byte_size(&1.pcm), 2))) |> Enum.max(fn -> 0 end)
    scale = 1 / :math.sqrt(max(length(tracks), 1))

    pcm =
      0..(total - 1)//@block
      |> Enum.map(fn start -> mix_block(tracks, start, min(@block, total - start), scale) end)
      |> IO.iodata_to_binary()

    {pcm, total}
  end

  defp mix_block(tracks, start, len, scale) do
    summed =
      tracks
      |> Enum.map(&slice(&1, start, len))
      |> Enum.reject(&is_nil/1)
      |> sum()

    case summed do
      nil -> :binary.copy(<<0, 0>>, len)
      sums -> for s <- sums, into: <<>>, do: <<clamp(round(s * scale))::little-signed-16>>
    end
  end

  # The part of `track` overlapping [start, start+len) as a list of exactly `len`
  # ints (zero-padded), or nil when it doesn't overlap at all.
  defp slice(%{offset: offset, pcm: pcm}, start, len) do
    samples = div(byte_size(pcm), 2)
    from = max(start, offset)
    to = min(start + len, offset + samples)

    if from >= to do
      nil
    else
      body = binary_part(pcm, (from - offset) * 2, (to - from) * 2)
      ints = for <<s::little-signed-16 <- body>>, do: s
      List.duplicate(0, from - start) ++ ints ++ List.duplicate(0, start + len - to)
    end
  end

  defp sum([]), do: nil
  defp sum([only]), do: only
  defp sum(lists), do: Enum.zip_with(lists, &Enum.sum/1)

  defp clamp(v) when v > @max, do: @max
  defp clamp(v) when v < @min, do: @min
  defp clamp(v), do: v
end
