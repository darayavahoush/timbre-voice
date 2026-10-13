defmodule TimbreWeb.FallbackController do
  @moduledoc "Turns `{:error, _}` tuples from controller actions into JSON responses."
  use TimbreWeb, :controller

  def call(conn, {:error, %Ecto.Changeset{} = changeset}) do
    conn
    |> put_status(:unprocessable_entity)
    |> put_view(json: TimbreWeb.ChangesetJSON)
    |> render(:error, changeset: changeset)
  end

  def call(conn, {:error, :not_found}) do
    conn |> put_status(:not_found) |> json(TimbreWeb.ErrorJSON.render("404.json", %{}))
  end

  def call(conn, {:error, :not_found, detail}) do
    conn |> put_status(:not_found) |> json(%{errors: %{detail: detail}})
  end

  def call(conn, {:error, :bad_request, detail}) do
    conn |> put_status(:bad_request) |> json(%{errors: %{detail: detail}})
  end

  def call(conn, {:error, :not_configured, detail}) do
    conn |> put_status(:service_unavailable) |> json(%{errors: %{detail: detail}})
  end

  def call(conn, {:error, :upstream, detail}) do
    conn |> put_status(:bad_gateway) |> json(%{errors: %{detail: detail}})
  end
end
