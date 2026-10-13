defmodule TimbreWeb.UserSocket do
  use Phoenix.Socket

  channel "session:*", TimbreWeb.SessionChannel

  # Sessions are link-based (unguessable id) — no accounts in this app.
  @impl true
  def connect(_params, socket, _connect_info), do: {:ok, socket}

  @impl true
  def id(_socket), do: nil
end
