#!/bin/sh
# VinaX web search — boot the engine on loopback, then the proxy on $PORT.
#
# POSIX sh only: the base image is Alpine, so there is no bash and no `wait -n`.
#
# Fails closed. Without SEARXNG_TOKEN the Caddyfile's header matcher would
# compare against `Bearer ` and the instance would answer anyone who found the
# hostname, so this refuses to start instead. Without SEARXNG_SECRET the engine
# would run with the placeholder key from settings.yml.
set -eu

if [ -z "${SEARXNG_TOKEN:-}" ]; then
  echo "!!! SEARXNG_TOKEN is not set. Refusing to start: the proxy would accept" >&2
  echo "!!! every request and this instance would be an open search proxy." >&2
  echo "!!! Generate one with: openssl rand -hex 32" >&2
  exit 78
fi

if [ -z "${SEARXNG_SECRET:-}" ]; then
  echo "!!! SEARXNG_SECRET is not set. Refusing to start: the engine would fall" >&2
  echo "!!! back to the placeholder key baked into settings.yml." >&2
  echo "!!! Generate one with: openssl rand -hex 32" >&2
  exit 78
fi

# An unset previous token must not widen the match to the empty string.
SEARXNG_TOKEN_PREVIOUS="${SEARXNG_TOKEN_PREVIOUS:-$SEARXNG_TOKEN}"
export SEARXNG_TOKEN_PREVIOUS

# Render routes one port and supplies it here; the Dockerfile's default covers
# a plain `docker run`.
PORT="${PORT:-10000}"
export PORT

# The engine answers the proxy only. Overriding both keeps it off every other
# interface even if the platform ever exposed more than $PORT.
GRANIAN_HOST="127.0.0.1"
GRANIAN_PORT="8080"
export GRANIAN_HOST GRANIAN_PORT

/usr/local/searxng/entrypoint.sh &
engine=$!

/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
proxy=$!

stop() {
  kill -TERM "$engine" "$proxy" 2>/dev/null || true
  wait "$engine" "$proxy" 2>/dev/null || true
}
trap stop TERM INT

# If either half dies the service is broken, so take the whole container down
# and let the platform restart it, rather than sit there half-alive answering
# 502s to every search.
while kill -0 "$engine" 2>/dev/null && kill -0 "$proxy" 2>/dev/null; do
  sleep 2
done

kill -0 "$engine" 2>/dev/null || echo "!!! the search engine exited; stopping the container" >&2
kill -0 "$proxy" 2>/dev/null || echo "!!! the proxy exited; stopping the container" >&2
stop
exit 1
