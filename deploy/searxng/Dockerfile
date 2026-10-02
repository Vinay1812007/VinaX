# VinaX web search — one image: the search engine plus the proxy that guards it.
#
# Why both in one container: a Render web service runs a single container and
# routes a single port, so the two-container layout of 8.3.0 (engine on an
# internal network, proxy published) has nowhere to put the second container.
# The proxy therefore runs beside the engine and talks to it over loopback.
#
# The proxy is not optional. The engine's own bot limiter has to be off (it
# would block the Worker: datacenter addresses, no browser headers), so the
# bearer-token check in the Caddyfile is the ONLY thing standing between this
# instance and anyone who finds the hostname. start.sh refuses to boot without
# a token for exactly that reason.
#
# To update the engine, change the pinned tag below and redeploy. If the build
# fails on an unknown tag, the pin has aged out — pick a current
# `YYYY.M.D-<commit>` tag from the upstream registry.

FROM docker.io/caddy:2-alpine AS proxy

FROM docker.io/searxng/searxng:2026.9.25-12f8b6515

# Caddy is a single static binary; take it from the official image rather than
# adding a package repository to this one.
#
# It is re-written byte for byte instead of being used where COPY puts it. The
# official image runs `setcap cap_net_bind_service=+ep` on that binary so it can
# bind port 80 as a non-root user, and the file capability survives the COPY.
# A host that will not grant the capability then refuses to exec the file at
# all — on Render the first deploy died with
# `caddy: Operation not permitted` — and `setcap` is not in this image to clear
# it. Streaming the bytes into a new file leaves the capability behind, and
# nothing here needs it: Caddy binds $PORT (10000), far above the privileged
# range.
# mkdir first: /usr/local/bin does not exist in the engine image. COPY creates
# missing parent directories, a shell redirect does not.
COPY --from=proxy /usr/bin/caddy /tmp/caddy.orig
RUN mkdir -p /usr/local/bin \
    && cat /tmp/caddy.orig > /usr/local/bin/caddy \
    && chmod 0755 /usr/local/bin/caddy \
    && rm /tmp/caddy.orig \
    && /usr/local/bin/caddy version

# settings.yml deliberately does NOT go to /etc/searxng. The base image
# declares that path as a VOLUME, and content written to a volume path after
# the VOLUME instruction is not guaranteed to survive into the running
# container. SEARXNG_SETTINGS_PATH pointing at a file is a supported mode
# (searx/settings_loader.py), so the config lives outside the volume and is
# named explicitly. The upstream entrypoint still writes its own default into
# /etc/searxng; the engine reads ours.
#
# server.secret_key stays the upstream placeholder in that file on purpose:
# the SEARXNG_SECRET environment variable overrides it, and start.sh refuses
# to boot if it is unset.
COPY settings.yml /usr/local/searxng/vinax-settings.yml
COPY Caddyfile /etc/caddy/Caddyfile
COPY start.sh /usr/local/bin/vinax-start

RUN chmod 0644 /usr/local/searxng/vinax-settings.yml /etc/caddy/Caddyfile \
    && chmod 0755 /usr/local/bin/vinax-start

ENV SEARXNG_SETTINGS_PATH=/usr/local/searxng/vinax-settings.yml \
    PORT=10000

# The engine binds loopback (start.sh), so this is the proxy's port — the one
# Render routes. Render supplies $PORT at runtime; the ENV above is only the
# default for a plain `docker run`.
EXPOSE 10000

ENTRYPOINT ["/usr/local/bin/vinax-start"]
