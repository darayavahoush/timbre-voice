defmodule Timbre.DataCase do
  @moduledoc "Test case for anything touching the database (SQL sandbox, one owner per test)."
  use ExUnit.CaseTemplate

  using do
    quote do
      alias Timbre.Repo
      import Ecto
      import Ecto.Changeset
      import Ecto.Query
      import Timbre.DataCase
    end
  end

  setup tags do
    Timbre.DataCase.setup_sandbox(tags)
    :ok
  end

  def setup_sandbox(tags) do
    # SQLite has a single writer, so DB tests run serially (async: false).
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Timbre.Repo, shared: not tags[:async])
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
  end
end
