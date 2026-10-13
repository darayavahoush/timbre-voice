defmodule Timbre.ByteRangeTest do
  use ExUnit.Case, async: true

  alias Timbre.ByteRange

  test "no header or garbage means the full body" do
    assert ByteRange.parse([], 100) == :full
    assert ByteRange.parse(["items=0-5"], 100) == :full
    assert ByteRange.parse(["bytes=abc"], 100) == :full
    assert ByteRange.parse(["bytes=0-1,5-9"], 100) == :full
    assert ByteRange.parse(["bytes=-"], 100) == :full
  end

  test "closed, open-ended and suffix ranges" do
    assert ByteRange.parse(["bytes=0-9"], 100) == {:ok, 0, 9}
    assert ByteRange.parse(["bytes=90-"], 100) == {:ok, 90, 99}
    assert ByteRange.parse(["bytes=-10"], 100) == {:ok, 90, 99}
  end

  test "end is clamped to the representation size" do
    assert ByteRange.parse(["bytes=50-5000"], 100) == {:ok, 50, 99}
    assert ByteRange.parse(["bytes=-5000"], 100) == {:ok, 0, 99}
  end

  test "unsatisfiable ranges" do
    assert ByteRange.parse(["bytes=100-"], 100) == :unsatisfiable
    assert ByteRange.parse(["bytes=500-600"], 100) == :unsatisfiable
    assert ByteRange.parse(["bytes=-0"], 100) == :unsatisfiable
  end

  test "an inverted range is ignored" do
    assert ByteRange.parse(["bytes=10-5"], 100) == :full
  end

  test "empty body can't be ranged" do
    assert ByteRange.parse(["bytes=0-1"], 0) == :full
  end
end
