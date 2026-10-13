defmodule Timbre.ByteRange do
  @moduledoc """
  Parses a single-range HTTP `Range: bytes=...` header (RFC 9110 §14).

  Browsers (Safari especially) refuse to seek or even play `<audio>` unless the
  server answers Range requests with `206 Partial Content`.
  """

  @type result :: :full | {:ok, non_neg_integer(), non_neg_integer()} | :unsatisfiable

  @doc """
  `headers` is what `Plug.Conn.get_req_header(conn, "range")` returns; `size`
  is the representation length. Returns inclusive `{:ok, first, last}`.
  Malformed, multi-range or non-`bytes` headers are ignored (`:full`), per spec.
  """
  @spec parse([String.t()], non_neg_integer()) :: result
  def parse([header | _], size) when size > 0 do
    case Regex.run(~r/^bytes=(\d*)-(\d*)$/, String.trim(header)) do
      [_, "", ""] -> :full
      [_, "", suffix] -> suffix_range(String.to_integer(suffix), size)
      [_, first, ""] -> bounded(String.to_integer(first), size - 1, size)
      [_, first, last] -> bounded(String.to_integer(first), String.to_integer(last), size)
      _ -> :full
    end
  end

  def parse(_headers, _size), do: :full

  # "bytes=-500" = the last 500 bytes
  defp suffix_range(0, _size), do: :unsatisfiable
  defp suffix_range(n, size), do: {:ok, max(size - n, 0), size - 1}

  defp bounded(first, _last, size) when first >= size, do: :unsatisfiable
  defp bounded(first, last, _size) when last < first, do: :full
  defp bounded(first, last, size), do: {:ok, first, min(last, size - 1)}
end
