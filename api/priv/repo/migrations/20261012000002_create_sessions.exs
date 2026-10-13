defmodule Timbre.Repo.Migrations.CreateSessions do
  use Ecto.Migration

  def change do
    create table(:sessions, primary_key: false) do
      # short, unguessable slug used in the share link (/s/<id>)
      add :id, :string, primary_key: true
      add :name, :string, null: false
      add :status, :string, null: false, default: "open"
      # only a hash of the host's secret is stored
      add :host_token_hash, :string, null: false
      add :recording_id, references(:recordings, on_delete: :nilify_all)
      add :finished_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create index(:sessions, [:recording_id])
  end
end
