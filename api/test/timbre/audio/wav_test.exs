defmodule Timbre.Audio.WavTest do
  use ExUnit.Case, async: true

  alias Timbre.Audio.Wav

  test "writes a canonical 44-byte header" do
    pcm = <<1, 0, 2, 0, 3, 0>>
    wav = Wav.encode(pcm, 16_000)

    assert <<"RIFF", riff_size::little-32, "WAVE", "fmt ", 16::little-32, 1::little-16,
             1::little-16, 16_000::little-32, 32_000::little-32, 2::little-16, 16::little-16,
             "data", data_size::little-32, ^pcm::binary>> = wav

    assert data_size == 6
    assert riff_size == byte_size(wav) - 8
  end

  test "duration" do
    assert Wav.duration_ms(16_000, 16_000) == 1000
    assert Wav.duration_ms(8_000, 16_000) == 500
  end
end
