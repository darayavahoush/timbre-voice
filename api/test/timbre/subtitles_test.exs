defmodule Timbre.SubtitlesTest do
  use ExUnit.Case, async: true

  alias Timbre.Subtitles

  describe "timestamp/1" do
    test "formats h:mm:ss,mmm with a comma" do
      assert Subtitles.timestamp(0) == "00:00:00,000"
      assert Subtitles.timestamp(1_234) == "00:00:01,234"
      assert Subtitles.timestamp(61_005) == "00:01:01,005"
      assert Subtitles.timestamp(3_723_456) == "01:02:03,456"
    end
  end

  describe "from_verbose_json/1" do
    test "converts seconds to ms, trims text and sorts" do
      segments = [
        %{"start" => 2.5, "end" => 4.0, "text" => " second "},
        %{"start" => 0.0, "end" => 2.4996, "text" => "first"}
      ]

      assert Subtitles.from_verbose_json(segments) == [
               %{"start_ms" => 0, "end_ms" => 2500, "text" => "first"},
               %{"start_ms" => 2500, "end_ms" => 4000, "text" => "second"}
             ]
    end

    test "drops blank and malformed segments" do
      segments = [
        %{"start" => 0, "end" => 1, "text" => "   "},
        %{"start" => "x", "end" => 1, "text" => "bad"},
        %{"text" => "no times"},
        %{"start" => 1, "end" => 2, "text" => "ok"}
      ]

      assert [%{"text" => "ok"}] = Subtitles.from_verbose_json(segments)
    end

    test "guarantees end > start" do
      [seg] = Subtitles.from_verbose_json([%{"start" => 3.0, "end" => 3.0, "text" => "blip"}])
      assert seg["end_ms"] > seg["start_ms"]
    end

    test "non-lists give no segments" do
      assert Subtitles.from_verbose_json(nil) == []
      assert Subtitles.from_verbose_json("nope") == []
    end
  end

  describe "to_srt/1" do
    test "numbers cues and separates them with a blank line" do
      segments = [
        %{"start_ms" => 0, "end_ms" => 1500, "text" => "Hello there."},
        %{"start_ms" => 1500, "end_ms" => 3_000, "text" => "General Kenobi."}
      ]

      assert Subtitles.to_srt(segments) ==
               "1\n00:00:00,000 --> 00:00:01,500\nHello there.\n" <>
                 "\n" <>
                 "2\n00:00:01,500 --> 00:00:03,000\nGeneral Kenobi.\n"
    end

    test "collapses blank lines inside a cue" do
      segments = [%{"start_ms" => 0, "end_ms" => 1000, "text" => "a\n\n\nb"}]
      assert Subtitles.to_srt(segments) =~ "\na\nb\n"
    end

    test "empty or missing segments render nothing" do
      assert Subtitles.to_srt([]) == ""
      assert Subtitles.to_srt(nil) == ""
    end
  end
end
