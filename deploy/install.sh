#!/usr/bin/env bash
# Quay one-shot installer for a fresh Ubuntu/Debian VPS.
#
#   QUAY_DOMAIN=example.com QUAY_ACME_EMAIL=you@example.com sudo -E ./deploy/install.sh
#
# Afterwards:
#   - dashboard:  https://quay.example.com
#   - deploys:    https://<project>.quay.example.com
#   - DNS needed: an A record for *.quay.example.com (and quay.example.com) → this box
#
# This script is idempotent. It installs Node 20+ and Caddy, runs quayd as a
# systemd service, and points Caddy at it with automatic TLS.
set -euo pipefail

: "${QUAY_DOMAIN:?set QUAY_DOMAIN (e.g. example.com)}"
: "${QUAY_ACME_EMAIL:?set QUAY_ACME_EMAIL (for Let's Encrypt)}"
QUAY_DIR="${QUAY_DIR:-/opt/quay}"
QUAY_DATA="${QUAY_DATA:-/var/lib/quay}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "▸ installing Node.js (if needed)…"
if ! command -v node >/dev/null || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "▸ installing Caddy (if needed)…"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

echo "▸ installing Quay to ${QUAY_DIR}…"
mkdir -p "$QUAY_DIR" "$QUAY_DATA"
cp -r "$REPO_DIR/src" "$REPO_DIR/bin" "$REPO_DIR/package.json" "$QUAY_DIR/"
id quay >/dev/null 2>&1 || useradd --system --home "$QUAY_DATA" --shell /usr/sbin/nologin quay
chown -R quay:quay "$QUAY_DATA"

echo "▸ writing systemd unit…"
cat > /etc/systemd/system/quay.service <<UNIT
[Unit]
Description=Quay deploy daemon
After=network.target

[Service]
User=quay
Environment=QUAY_DATA=${QUAY_DATA}
Environment=QUAY_PORT=7000
Environment=QUAY_SCHEME=https
Environment=QUAY_PUBLIC_PORT=443
Environment=QUAY_ADMIN_HOST=quay.${QUAY_DOMAIN}
Environment=QUAY_DEPLOY_SUFFIX=quay.${QUAY_DOMAIN}
ExecStart=/usr/bin/node ${QUAY_DIR}/bin/quayd.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT

echo "▸ writing Caddyfile…"
export QUAY_DOMAIN QUAY_ACME_EMAIL
envsubst < "$REPO_DIR/deploy/Caddyfile.tmpl" > /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable --now quay
systemctl reload caddy || systemctl restart caddy

echo ""
echo "✓ Quay is up."
echo "  dashboard: https://quay.${QUAY_DOMAIN}"
echo "  token:     sudo -u quay cat ${QUAY_DATA}/config.json"
echo "  DNS:       point  *.quay.${QUAY_DOMAIN}  and  quay.${QUAY_DOMAIN}  at this server"
