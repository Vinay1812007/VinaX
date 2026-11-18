#!/usr/bin/env bash
# Build the Node server and put it on the VM.
#
#   VINAX_VM=ubuntu@<vm address> backend/server/deploy/deploy.sh
#
# Copies server/dist/vinax-api.mjs (+ map) to /opt/vinax-api, restarts the
# service and checks /__health on the VM. Needs setup-vm.sh run once first.
set -euo pipefail
: "${VINAX_VM:?set VINAX_VM=user@host}"
backend="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$backend"
npm run -s server:build
scp -q server/dist/vinax-api.mjs server/dist/vinax-api.mjs.map "$VINAX_VM:/opt/vinax-api/"
ssh "$VINAX_VM" 'sudo systemctl restart vinax-api && for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS http://127.0.0.1:8787/__health >/dev/null 2>&1 && { echo "vinax-api is up"; exit 0; }; sleep 1; done; echo "vinax-api did not come up:" >&2; sudo systemctl status vinax-api --no-pager -n 30 >&2; exit 1'
