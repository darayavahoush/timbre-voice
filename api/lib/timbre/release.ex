defmodule Timbre.Release do
  @moduledoc "Release tasks. Run `Timbre.Release.migrate()` via `bin/timbre eval` before boot."

  @app :timbre

  def migrate do
    Application.load(@app)

    for repo <- Application.fetch_env!(@app, :ecto_repos) do
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end
end
