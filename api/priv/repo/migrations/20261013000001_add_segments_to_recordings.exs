defmodule Timbre.Repo.Migrations.AddSegmentsToRecordings do
  use Ecto.Migration

  def change do
    alter table(:recordings) do
      # Timed transcript segments ([{start_ms, end_ms, text}]) from Whisper's
      # verbose_json — the source for SRT export. Nullable: takes transcribed
      # before this column existed simply have no timing.
      add :segments, :text
    end
  end
end
