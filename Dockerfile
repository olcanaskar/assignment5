FROM denoland/deno:2.6.3

WORKDIR /app

# Dependencies first: a source change does not download them again.
COPY deno.json deno.lock* ./
COPY src ./src
COPY drizzle ./drizzle
COPY scripts ./scripts

RUN deno cache --unstable-kv --unstable-cron src/main.ts

# The database and uploads live on a volume. Run as the non-root deno user.
RUN mkdir -p /data/uploads && chown -R deno:deno /data
USER deno

ENV DATABASE_URL=file:/data/tasks.db \
    PORT=8000 \
    UPLOAD_DIR=/data/uploads \
    KV_PATH=/data/kv.sqlite

EXPOSE 8000

CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "--allow-sys", "--unstable-kv", "--unstable-cron", "src/main.ts"]
