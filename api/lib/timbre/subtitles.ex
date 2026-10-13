defmodule Timbre.Subtitles do
  @moduledoc """
  Timed transcript segments and the SubRip (`.srt`) format.

  A segment is `%{"start_ms" => int, "end_ms" => int, "text" => string}`.
  """

  @type segment :: %{String.t() => term()}

  @doc """
  Normalizes the `segments` array of an OpenAI-style `verbose_json` response
  (`start`/`end` in float seconds) into stored segments. Blank or malformed
  entries are dropped; the result is sorted and every segment has `end > start`.
  """
  @spec from_verbose_json(term()) :: [segment()]
  def from_verbose_json(segments) when is_list(segments) do
    segments
    |> Enum.flat_map(&normalize/1)
    |> Enum.sort_by(& &1["start_ms"])
  end

  def from_verbose_json(_), do: []

  defp normalize(%{"start" => s, "end" => e, "text" => text})
       when is_number(s) and is_number(e) and is_binary(text) do
    case String.trim(text) do
      "" ->
        []

      trimmed ->
        start_ms = s |> Kernel.*(1000) |> round() |> max(0)
        end_ms = e |> Kernel.*(1000) |> round() |> max(start_ms + 1)
        [%{"start_ms" => start_ms, "end_ms" => end_ms, "text" => trimmed}]
    end
  end

  defp normalize(_), do: []

  @doc "Renders segments as SubRip. Returns `\"\"` when there are none."
  @spec to_srt([segment()] | nil) :: String.t()
  def to_srt(nil), do: ""
  def to_srt([]), do: ""

  def to_srt(segments) do
    segments
    |> Enum.with_index(1)
    |> Enum.map_join("\n", fn {seg, n} ->
      [
        Integer.to_string(n),
        "#{timestamp(seg["start_ms"])} --> #{timestamp(seg["end_ms"])}",
        clean(seg["text"]),
        ""
      ]
      |> Enum.join("\n")
    end)
  end

  @doc "`3_723_456` -> `\"01:02:03,456\"` (SRT uses a comma before the millis)."
  @spec timestamp(non_neg_integer()) :: String.t()
  def timestamp(ms) when is_integer(ms) and ms >= 0 do
    h = div(ms, 3_600_000)
    m = ms |> rem(3_600_000) |> div(60_000)
    s = ms |> rem(60_000) |> div(1000)
    milli = rem(ms, 1000)
    "#{pad(h, 2)}:#{pad(m, 2)}:#{pad(s, 2)},#{pad(milli, 3)}"
  end

  defp pad(n, width), do: n |> Integer.to_string() |> String.pad_leading(width, "0")

  # A blank line ends a cue in SRT, so collapse any run of newlines to one.
  defp clean(text), do: text |> String.replace(~r/\s*\n\s*/, "\n") |> String.trim()
end
