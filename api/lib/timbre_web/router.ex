defmodule TimbreWeb.Router do
  use TimbreWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  # Ops probes — unauthenticated, no `:accepts` plug so bare LB/k8s probes work.
  scope "/", TimbreWeb do
    get "/healthz", HealthController, :live
    get "/readyz", HealthController, :ready
  end

  # Media/download endpoints: no `:accepts` — <audio> elements and plain links
  # send arbitrary Accept headers.
  scope "/api", TimbreWeb do
    get "/recordings/:id/audio", RecordingController, :audio
    get "/recordings/:id/transcript.srt", RecordingController, :srt
  end

  scope "/api", TimbreWeb do
    pipe_through :api

    get "/hello", HelloController, :show

    resources "/recordings", RecordingController, only: [:index, :show, :create, :update, :delete]
    post "/recordings/:id/transcribe", RecordingController, :transcribe

    post "/sessions", SessionController, :create
    get "/sessions/:id", SessionController, :show
  end

  # Everything else is the single-page app (production builds only).
  scope "/", TimbreWeb do
    get "/*path", SpaController, :index
  end
end
