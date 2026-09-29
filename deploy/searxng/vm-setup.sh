#!/usr/bin/env bash
# VinaX web search — one-command setup on a fresh Linux VM (Ubuntu or Debian,
# x86-64 or ARM; e.g. an always-free Oracle Cloud or Google Cloud VM).
#
#   curl -fsSL https://raw.githubusercontent.com/Vinay1812007/VinaX/main/deploy/searxng/vm-setup.sh -o vm-setup.sh
#   bash vm-setup.sh
#
# It installs Docker if needed, downloads this folder into ~/vinax-search,
# asks for the two secrets it cannot make up (the tunnel's connector token and
# the token the VinaX Worker sends), generates SearXNG's own secret, and starts
# SearXNG + the token-checking proxy + the Cloudflare Tunnel connector in
# tunnel mode (no open ports). Re-running it keeps your .env and updates the
# files. See README.md → "Free cloud VM".
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Vinay1812007/VinaX/main/deploy/searxng"
DIR="${VINAX_SEARCH_DIR:-$HOME/vinax-search}"
FILES="docker-compose.yml docker-compose.tunnel.yml settings.yml proxy.conf .env.example"
HOSTNAME_DEFAULT="search.sirimillavinay.online"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\nError: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || die "run this on the Linux VM, not on your laptop."
command -v curl > /dev/null || die "curl is missing (sudo apt-get install -y curl)."
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

# 1. Docker ------------------------------------------------------------------
if ! command -v docker > /dev/null; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
$SUDO docker compose version > /dev/null 2>&1 || die "Docker's compose plugin is missing (sudo apt-get install -y docker-compose-plugin)."
DOCKER="$SUDO docker"

# 2. A little swap on 1 GB machines, so a busy moment cannot kill SearXNG ---
MEM_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if [ "${MEM_KB:-0}" -lt 1800000 ] && ! $SUDO swapon --show | grep -q .; then
  say "Adding 1 GB of swap (this VM has less than 2 GB of memory)…"
  $SUDO fallocate -l 1G /swapfile || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=1024
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile > /dev/null
  $SUDO swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab > /dev/null
fi

# 3. The kit -----------------------------------------------------------------
say "Downloading the web search kit into $DIR…"
mkdir -p "$DIR"
for f in $FILES; do
  curl -fsSL "$REPO_RAW/$f" -o "$DIR/$f.new"
  mv "$DIR/$f.new" "$DIR/$f"
done
# SearXNG runs without capabilities and must be able to read these.
chmod 644 "$DIR"/docker-compose.yml "$DIR"/docker-compose.tunnel.yml "$DIR"/settings.yml "$DIR"/proxy.conf

# 4. Secrets (.env) ----------------------------------------------------------
ENV_FILE="$DIR/.env"
get() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
HOST="$(get SEARXNG_HOSTNAME)"; SECRET="$(get SEARXNG_SECRET)"; TOKEN="$(get SEARXNG_TOKEN)"; TUNNEL="$(get CLOUDFLARE_TUNNEL_TOKEN)"
[ -n "$HOST" ] || HOST="$HOSTNAME_DEFAULT"
[ -n "$SECRET" ] || SECRET="$(openssl rand -hex 32)"
if [ -z "$TUNNEL" ]; then
  say "Paste the connector token of the tunnel 'vinax-search'"
  echo "(Cloudflare dashboard → Networking → Tunnels → vinax-search → Configure → the long value after --token)"
  read -r -s -p "Tunnel token: " TUNNEL; echo
  TUNNEL="$(printf '%s' "$TUNNEL" | sed -E 's/.*--token[ =]+//; s/[[:space:]]//g')"
  [ -n "$TUNNEL" ] || die "no tunnel token given."
fi
if [ -z "$TOKEN" ]; then
  say "The token the VinaX Worker sends (its SEARXNG_TOKEN secret)"
  echo "Paste the value you set on the Worker, or press Enter to generate a new one"
  echo "(then set that new value on the Worker — the script prints the command)."
  read -r -s -p "SEARXNG_TOKEN: " TOKEN; echo
  if [ -z "$TOKEN" ]; then TOKEN="$(openssl rand -hex 32)"; NEW_TOKEN=1; fi
fi
umask 077
cat > "$ENV_FILE" <<EOF
SEARXNG_HOSTNAME=$HOST
SEARXNG_SECRET=$SECRET
SEARXNG_TOKEN=$TOKEN
CLOUDFLARE_TUNNEL_TOKEN=$TUNNEL
EOF
chmod 600 "$ENV_FILE"

# 5. Start -------------------------------------------------------------------
say "Starting SearXNG, the proxy and the tunnel connector…"
cd "$DIR"
COMPOSE="$DOCKER compose -f docker-compose.yml -f docker-compose.tunnel.yml"
$COMPOSE pull --quiet
$COMPOSE up -d --remove-orphans

# 6. Check -------------------------------------------------------------------
say "Checking (this can take up to a minute on the first start)…"
OK=""
for _ in $(seq 1 30); do
  if $COMPOSE exec -T proxy wget -q -O - --header "Authorization: Bearer $TOKEN" \
      "http://127.0.0.1:8888/search?q=telugu+songs&format=json" 2> /dev/null | grep -q '"results"'; then
    OK=1; break
  fi
  sleep 3
done
if [ -n "$OK" ]; then
  echo "SearXNG answers through the proxy on this VM."
else
  echo "SearXNG did not answer yet. Look at: $COMPOSE logs --tail 50"
fi
if $COMPOSE logs cloudflared 2>&1 | grep -q "Registered tunnel connection"; then
  echo "The tunnel connector is connected to Cloudflare."
else
  echo "The tunnel connector has not connected yet. Look at: $COMPOSE logs cloudflared"
fi

say "Next steps"
echo "1. Check from anywhere:"
echo "   curl -s -H 'Authorization: Bearer <SEARXNG_TOKEN>' 'https://$HOST/search?q=telugu+songs&format=json' | head -c 120"
if [ -n "${NEW_TOKEN:-}" ]; then
  echo "2. A NEW token was generated. Set it on the Worker (from VinaX/backend on your computer):"
  echo "   npx wrangler secret put SEARXNG_TOKEN --config worker/wrangler.toml"
  echo "   and paste the SEARXNG_TOKEN value from $ENV_FILE (sudo cat $ENV_FILE)."
fi
echo "3. Stop the tunnel connector on your laptop, so every request goes to this VM:"
echo "   sudo cloudflared service uninstall   (macOS/Linux), and close any 'cloudflared tunnel run' window."
echo "4. Owner console → Technical → System health → 'Web search engine' should show results."
