defmodule TimbreWeb.ChannelCase do
  @moduledoc "Test case for channels (shares the DB sandbox)."
  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest
      import TimbreWeb.ChannelCase

      @endpoint TimbreWeb.Endpoint
    end
  end

  setup tags do
    Timbre.DataCase.setup_sandbox(tags)
    :ok
  end
end
