#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VM (Oracle Cloud Always Free,
# Ampere A1 / arm64, or any other) for the VinaX API.
#
#   scp backend/server/deploy/{setup-vm.sh,vinax-api.service} ubuntu@<vm>:
#   ssh ubuntu@<vm> 'sudo bash setup-vm.sh'
#
# It installs Node 22, cloudflared and automatic security updates, creates
# the `vinax` user, /opt/vinax-api and /etc/vinax-api/env, and the service.
# It opens no ports: traffic arrives through the Cloudflare Tunnel.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq ca-certificates curl gnupg unattended-upgrades

# Node.js 22 LTS (NodeSource).
if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])\.'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -yq nodejs
fi

# cloudflared (Cloudflare's apt repository).
if ! command -v cloudflared >/dev/null; then
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -q
  apt-get install -yq cloudflared
fi

# Security updates install themselves (and reboot at 03:30 UTC if needed).
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat > /etc/apt/apt.conf.d/52vinax-reboot <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
CONF

# The service user and folders.
id vinax >/dev/null 2>&1 || useradd --system --home /opt/vinax-api --shell /usr/sbin/nologin vinax
install -d -o vinax -g vinax -m 0755 /opt/vinax-api
install -d -o vinax -g vinax -m 0700 /opt/vinax-api/data
install -d -o root -g vinax -m 0750 /etc/vinax-api
if [ ! -f /etc/vinax-api/env ]; then
  install -o root -g vinax -m 0640 /dev/null /etc/vinax-api/env
  echo "# NAME=value lines: every Worker secret (backend/.env.example)." > /etc/vinax-api/env
fi

# The deploying account (the one running sudo) may update the bundle.
deployer="${SUDO_USER:-ubuntu}"
usermod -aG vinax "$deployer"
chmod g+w /opt/vinax-api

install -m 0644 "$here/vinax-api.service" /etc/systemd/system/vinax-api.service
systemctl daemon-reload
systemctl enable vinax-api >/dev/null
# Let the deploying account restart the service without a password.
echo "$deployer ALL=(root) NOPASSWD: /usr/bin/systemctl restart vinax-api, /usr/bin/systemctl status vinax-api *" > /etc/sudoers.d/vinax-api
chmod 0440 /etc/sudoers.d/vinax-api

echo
echo "Done. Node $(node -v), $(cloudflared --version | head -1)."
echo "Next: put the secrets in /etc/vinax-api/env (sudo nano /etc/vinax-api/env),"
echo "deploy the bundle from your Mac (backend/server/deploy/deploy.sh), then set up the tunnel."
