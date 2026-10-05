# The app service: built site + HyperFrames Studio API + video job loop, one container.
# Built from the repo root (the worker imports frontend/src/storyboard/composition.ts).

# --- The site. VITE_* come from the service's Railway variables (passed as build args).
FROM node:24-bookworm-slim AS site
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
# `vite build` without `tsc`: the frontend tests import supabase/, which isn't in the image.
RUN npx vite build

# --- The server.
FROM node:24-bookworm-slim

# FFmpeg for encoding, Noto fonts (Latin + Devanagari) for captions, and the shared
# libraries HyperFrames' pinned headless Chrome needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg fonts-noto-core unzip \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 \
      libnss3 libpango-1.0-0 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

ENV HYPERFRAMES_NO_TELEMETRY=1 DATA_DIR=/data
WORKDIR /app/worker
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev \
    && node node_modules/hyperframes/bin/hyperframes.mjs telemetry disable \
    && node node_modules/hyperframes/bin/hyperframes.mjs browser ensure
COPY worker/ ./
COPY frontend/src/storyboard/ /app/frontend/src/storyboard/
COPY --from=site /app/frontend/dist /app/frontend/dist
COPY bridge/ /app/bridge/

CMD ["node", "index.ts"]
