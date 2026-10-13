defmodule Timbre.Sessions.Session do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  schema "sessions" do
    field :name, :string
    field :status, :string, default: "open"
    field :host_token_hash, :string
    field :finished_at, :utc_datetime

    belongs_to :recording, Timbre.Recordings.Recording

    timestamps(type: :utc_datetime)
  end

  def create_changeset(session, attrs) do
    session
    |> cast(attrs, [:name])
    |> update_change(:name, &String.trim/1)
    |> then(fn cs ->
      if get_field(cs, :name) in [nil, ""],
        do: put_change(cs, :name, "Untitled session"),
        else: cs
    end)
    |> validate_length(:name, max: 80)
  end
end
