defmodule TimbreWeb.RecordingControllerTest do
  use TimbreWeb.ConnCase, async: false

  @audio :crypto.strong_rand_bytes(1000)

  defp upload(bytes \\ @audio, content_type \\ "audio/webm;codecs=opus") do
    path = Path.join(System.tmp_dir!(), "timbre-test-#{System.unique_integer([:positive])}.bin")
    File.write!(path, bytes)
    on_exit(fn -> File.rm(path) end)
    %Plug.Upload{path: path, filename: "take.webm", content_type: content_type}
  end

  defp create!(conn, extra \\ %{}) do
    conn
    |> post(~p"/api/recordings", Map.merge(%{"audio" => upload(), "title" => "Hello"}, extra))
    |> json_response(201)
    |> Map.fetch!("data")
  end

  describe "POST /api/recordings" do
    test "stores the upload and returns metadata", %{conn: conn} do
      data = create!(conn, %{"duration_ms" => "2500", "sample_rate" => "48000"})
      assert data["title"] == "Hello"
      assert data["mime_type"] == "audio/webm"
      assert data["byte_size"] == 1000
      assert data["duration_ms"] == 2500
      assert data["audio_url"] == "/api/recordings/#{data["id"]}/audio"
      refute Map.has_key?(data, "audio")
    end

    test "records the effect chain and parent of a processed take", %{conn: conn} do
      original = create!(conn)
      effects = Jason.encode!(%{"chain" => [%{"type" => "gain", "db" => 3}]})

      data =
        create!(conn, %{
          "kind" => "processed",
          "parent_id" => original["id"],
          "effects" => effects,
          "audio" => upload(@audio, "audio/wav")
        })

      assert data["kind"] == "processed"
      assert data["parent_id"] == original["id"]
      assert data["effects"] == %{"chain" => [%{"type" => "gain", "db" => 3}]}
    end

    test "400 without an audio part", %{conn: conn} do
      conn = post(conn, ~p"/api/recordings", %{"title" => "nope"})
      assert %{"errors" => %{"detail" => _}} = json_response(conn, 400)
    end

    test "422 for non-audio uploads", %{conn: conn} do
      conn = post(conn, ~p"/api/recordings", %{"audio" => upload(@audio, "image/png")})
      assert %{"errors" => %{"mime_type" => [_]}} = json_response(conn, 422)
    end

    test "400 for malformed effects JSON", %{conn: conn} do
      conn = post(conn, ~p"/api/recordings", %{"audio" => upload(), "effects" => "[1,2"})
      assert json_response(conn, 400)
    end
  end

  describe "GET /api/recordings" do
    test "lists newest first without audio", %{conn: conn} do
      a = create!(conn, %{"title" => "first"})
      b = create!(conn, %{"title" => "second"})
      %{"data" => list} = conn |> get(~p"/api/recordings") |> json_response(200)
      assert Enum.map(list, & &1["id"]) == [b["id"], a["id"]]
    end

    test "show 404s for unknown and non-numeric ids", %{conn: conn} do
      assert conn |> get(~p"/api/recordings/999") |> json_response(404)
      assert conn |> get(~p"/api/recordings/abc") |> json_response(404)
    end
  end

  describe "GET /api/recordings/:id/audio" do
    setup %{conn: conn}, do: {:ok, id: create!(conn)["id"]}

    test "serves the full blob with the right headers", %{conn: conn, id: id} do
      conn = get(conn, ~p"/api/recordings/#{id}/audio")
      assert response(conn, 200) == @audio
      assert get_resp_header(conn, "content-type") == ["audio/webm"]
      assert get_resp_header(conn, "accept-ranges") == ["bytes"]
    end

    test "206 for a byte range", %{conn: conn, id: id} do
      conn =
        conn
        |> put_req_header("range", "bytes=10-19")
        |> get(~p"/api/recordings/#{id}/audio")

      assert response(conn, 206) == binary_part(@audio, 10, 10)
      assert get_resp_header(conn, "content-range") == ["bytes 10-19/1000"]
    end

    test "open-ended and suffix ranges", %{conn: conn, id: id} do
      c1 = conn |> put_req_header("range", "bytes=990-") |> get(~p"/api/recordings/#{id}/audio")
      assert response(c1, 206) == binary_part(@audio, 990, 10)
      c2 = conn |> put_req_header("range", "bytes=-5") |> get(~p"/api/recordings/#{id}/audio")
      assert response(c2, 206) == binary_part(@audio, 995, 5)
    end

    test "416 when the range starts past the end", %{conn: conn, id: id} do
      conn =
        conn |> put_req_header("range", "bytes=5000-") |> get(~p"/api/recordings/#{id}/audio")

      assert response(conn, 416) == ""
      assert get_resp_header(conn, "content-range") == ["bytes */1000"]
    end

    test "304 when the ETag matches", %{conn: conn, id: id} do
      [etag] = conn |> get(~p"/api/recordings/#{id}/audio") |> get_resp_header("etag")

      conn =
        build_conn()
        |> put_req_header("if-none-match", etag)
        |> get(~p"/api/recordings/#{id}/audio")

      assert response(conn, 304) == ""
    end

    test "works for browsers' arbitrary Accept headers", %{conn: conn, id: id} do
      conn =
        conn
        |> put_req_header("accept", "audio/webm,audio/ogg;q=0.9")
        |> get(~p"/api/recordings/#{id}/audio")

      assert response(conn, 200) == @audio
    end

    test "404 for unknown id", %{conn: conn} do
      assert conn |> get(~p"/api/recordings/424242/audio") |> json_response(404)
    end
  end

  describe "PATCH / DELETE" do
    test "renames", %{conn: conn} do
      id = create!(conn)["id"]
      conn = patch(conn, ~p"/api/recordings/#{id}", %{"title" => "  Renamed  "})
      assert json_response(conn, 200)["data"]["title"] == "Renamed"
    end

    test "rejects a blank title", %{conn: conn} do
      id = create!(conn)["id"]
      assert conn |> patch(~p"/api/recordings/#{id}", %{"title" => "  "}) |> json_response(422)
    end

    test "deletes", %{conn: conn} do
      id = create!(conn)["id"]
      assert conn |> delete(~p"/api/recordings/#{id}") |> response(204)
      assert build_conn() |> get(~p"/api/recordings/#{id}") |> json_response(404)
    end
  end

  describe "POST /api/recordings/:id/transcribe" do
    test "stores transcript, summary and a better title", %{conn: conn} do
      id = create!(conn, %{"title" => "Untitled recording"})["id"]

      Req.Test.stub(Timbre.Transcription, fn conn ->
        case conn.request_path do
          "/v1/audio/transcriptions" ->
            assert ["Bearer test-key"] == Plug.Conn.get_req_header(conn, "authorization")
            Req.Test.json(conn, %{"text" => "Remember to ship the demo on Friday."})

          "/v1/chat/completions" ->
            content =
              Jason.encode!(%{
                "title" => "Friday demo reminder",
                "summary" => "Ship the demo on Friday."
              })

            Req.Test.json(conn, %{"choices" => [%{"message" => %{"content" => content}}]})
        end
      end)

      data =
        conn
        |> post(~p"/api/recordings/#{id}/transcribe")
        |> json_response(200)
        |> Map.fetch!("data")

      assert data["transcript"] == "Remember to ship the demo on Friday."
      assert data["summary"] == "Ship the demo on Friday."
      assert data["title"] == "Friday demo reminder"
    end

    test "keeps a user-chosen title", %{conn: conn} do
      id = create!(conn, %{"title" => "Standup"})["id"]

      Req.Test.stub(Timbre.Transcription, fn conn ->
        case conn.request_path do
          "/v1/audio/transcriptions" ->
            Req.Test.json(conn, %{"text" => "hello"})

          _ ->
            content = Jason.encode!(%{"title" => "Greeting", "summary" => "A greeting."})
            Req.Test.json(conn, %{"choices" => [%{"message" => %{"content" => content}}]})
        end
      end)

      data =
        conn
        |> post(~p"/api/recordings/#{id}/transcribe")
        |> json_response(200)
        |> Map.fetch!("data")

      assert data["title"] == "Standup"
      assert data["summary"] == "A greeting."
    end

    test "502 when the provider errors", %{conn: conn} do
      id = create!(conn)["id"]

      Req.Test.stub(Timbre.Transcription, fn conn ->
        conn
        |> Plug.Conn.put_status(401)
        |> Req.Test.json(%{"error" => %{"message" => "bad key"}})
      end)

      body = conn |> post(~p"/api/recordings/#{id}/transcribe") |> json_response(502)
      assert body["errors"]["detail"] =~ "bad key"
    end

    test "503 when no API key is configured", %{conn: conn} do
      id = create!(conn)["id"]
      original = Application.get_env(:timbre, Timbre.Transcription)
      Application.put_env(:timbre, Timbre.Transcription, Keyword.put(original, :api_key, nil))
      on_exit(fn -> Application.put_env(:timbre, Timbre.Transcription, original) end)

      body = conn |> post(~p"/api/recordings/#{id}/transcribe") |> json_response(503)
      assert body["errors"]["detail"] =~ "OPENAI_API_KEY"
    end
  end

  test "unknown /api paths 404 as JSON instead of falling into the SPA", %{conn: conn} do
    assert conn |> get("/api/nope") |> json_response(404)
  end
end
