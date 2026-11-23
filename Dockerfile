FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3-venv \
    && python3 -m venv /opt/downloader \
    && /opt/downloader/bin/pip install --no-cache-dir 'yt-dlp[default]==2026.10.26' \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/downloader/bin:${PATH}" HOST=0.0.0.0 PORT=10000
WORKDIR /app
COPY server.mjs sources.mjs proxy-key.sha256 ./
COPY web ./web
USER node
CMD ["node", "server.mjs"]
