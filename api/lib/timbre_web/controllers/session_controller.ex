defmodule TimbreWeb.SessionController do
  use TimbreWeb, :controller

  alias Timbre.Sessions

  action_fallback TimbreWeb.FallbackController

  @doc "Creates a session; the response carries the one-time `host_token`."
  def create(conn, params) do
    with {:ok, session, host_token} <- Sessions.create_session(Map.take(params, ["name"])) do
      conn
      |> put_status(:created)
      |> render(:show, session: session, host_token: host_token)
    end
  end

  def show(conn, %{"id" => id}) do
    with {:ok, session} <- Sessions.fetch(id), do: render(conn, :show, session: session)
  end
end
