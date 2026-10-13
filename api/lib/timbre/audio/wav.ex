defmodule Timbre.Audio.Wav do
  @moduledoc "Minimal 16-bit PCM WAV container writer."

  @doc "Wraps raw little-endian signed 16-bit PCM in a RIFF/WAVE header."
  @spec encode(binary(), pos_integer(), pos_integer()) :: binary()
  def encode(pcm, sample_rate, channels \\ 1) when is_binary(pcm) do
    data_len = byte_size(pcm)

    <<"RIFF", 36 + data_len::little-32, "WAVE", "fmt ", 16::little-32, 1::little-16,
      channels::little-16, sample_rate::little-32, sample_rate * channels * 2::little-32,
      channels * 2::little-16, 16::little-16, "data", data_len::little-32, pcm::binary>>
  end

  @doc "Duration in whole milliseconds of `samples` mono samples."
  def duration_ms(samples, sample_rate), do: div(samples * 1000, sample_rate)
end
