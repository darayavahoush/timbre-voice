# One image, one origin: Phoenix serves the API, the websocket and the built React app.

# ---- 1. web: Rust -> WASM, then the Vite build ---------------------------------
FROM node:22-bookworm AS web
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --target wasm32-unknown-unknown
ENV PATH="/root/.cargo/bin:${PATH}"
RUN curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
COPY web/crates ./crates
RUN npm run build:wasm && npm ci
COPY web/ ./
RUN npm run build

# ---- 2. api: release ------------------------------------------------------------
FROM elixir:1.18-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV MIX_ENV=prod
WORKDIR /src/api
RUN mix local.hex --force && mix local.rebar --force
COPY api/mix.exs api/mix.lock ./
RUN mix deps.get --only prod && mkdir config
COPY api/config/config.exs api/config/prod.exs config/
RUN mix deps.compile
COPY api/lib lib
COPY api/priv priv
COPY --from=web /src/web/dist/ priv/static/
COPY api/config/runtime.exs config/
RUN mix release

# ---- 3. runtime ------------------------------------------------------------------
FROM elixir:1.18-slim
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=api /src/api/_build/prod/rel/timbre ./
ENV PHX_SERVER=true PORT=8080 DATABASE_PATH=/data/timbre.db
EXPOSE 8080
CMD ["sh", "-c", "bin/timbre eval \"Timbre.Release.migrate()\" && exec bin/timbre start"]
