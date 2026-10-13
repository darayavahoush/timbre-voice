defmodule TimbreWeb.SpaController do
  @moduledoc """
  Serves the built React app (`priv/static/index.html`) for any non-API GET so
  client-side routes like `/s/abc123` survive a refresh / shared link. In dev the
  Vite server on :5173 plays this role instead.
  """
  use TimbreWeb, :controller

  def index(conn, %{"path" => ["api" | _]}) do
    conn |> put_status(:not_found) |> json(TimbreWeb.ErrorJSON.render("404.json", %{}))
  end

  def index(conn, _params) do
    path = Application.app_dir(:timbre, "priv/static/index.html")

    if File.regular?(path) do
      conn |> put_resp_content_type("text/html") |> send_file(200, path)
    else
      conn
      |> put_status(:not_found)
      |> text("Frontend not built. Use the Vite dev server on :5173, or run `just build`.")
    end
  end
end
