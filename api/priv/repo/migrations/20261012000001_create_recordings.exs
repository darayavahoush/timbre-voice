defmodule Timbre.Repo.Migrations.CreateRecordings do
  use Ecto.Migration

  def change do
    create table(:recordings) do
      add :title, :string, null: false
      # original = straight from the mic, processed = output of the WASM chain,
      # mix = server-side mix of a multiplayer session
      add :kind, :string, null: false, default: "original"
      add :mime_type, :string, null: false
      add :duration_ms, :integer, null: false, default: 0
      add :byte_size, :integer, null: false
      add :sample_rate, :integer
      add :audio, :binary, null: false
      # the effect chain that produced a "processed" take, as the client sent it
      add :effects, :map, null: false, default: %{}
      add :transcript, :text
      add :summary, :text
      # a processed take points at the original it was derived from
      add :parent_id, references(:recordings, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create index(:recordings, [:inserted_at])
    create index(:recordings, [:parent_id])
  end
end
