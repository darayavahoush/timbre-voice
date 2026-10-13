defmodule TimbreWeb.SessionControllerTest do
  use TimbreWeb.ConnCase, async: false

  test "creates a session and returns a one-time host token", %{conn: conn} do
    %{"data" => data} =
      conn |> post(~p"/api/sessions", %{"name" => "  Weekly sync "}) |> json_response(201)

    assert data["name"] == "Weekly sync"
    assert data["status"] == "open"
    assert byte_size(data["id"]) == 8
    assert is_binary(data["host_token"])

    %{"data" => shown} =
      build_conn() |> get(~p"/api/sessions/#{data["id"]}") |> json_response(200)

    assert shown["id"] == data["id"]
    refute Map.has_key?(shown, "host_token")
  end

  test "defaults the name and rejects an overlong one", %{conn: conn} do
    assert %{"data" => %{"name" => "Untitled session"}} =
             conn |> post(~p"/api/sessions", %{}) |> json_response(201)

    assert %{"errors" => %{"name" => [_]}} =
             build_conn()
             |> post(~p"/api/sessions", %{"name" => String.duplicate("a", 81)})
             |> json_response(422)
  end

  test "404 for unknown sessions", %{conn: conn} do
    assert conn |> get(~p"/api/sessions/nope") |> json_response(404)
  end
end
