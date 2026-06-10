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

apt-get update -y

echo "▸ installing Node.js (if needed)…"
if ! command -v node >/dev/null || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y gettext-base   # envsubst

echo "▸ installing Caddy (if needed)…"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

echo "▸ installing Quay to ${QUAY_DIR}…"
mkdir -p "$QUAY_DIR" "$QUAY_DATA"
rsync -a --delete "$REPO_DIR/src" "$REPO_DIR/bin" "$REPO_DIR/package.json" "$QUAY_DIR/" 2>/dev/null \
  || { rm -rf "$QUAY_DIR/src" "$QUAY_DIR/bin"; cp -r "$REPO_DIR/src" "$REPO_DIR/bin" "$REPO_DIR/package.json" "$QUAY_DIR/"; }
id quay >/dev/null 2>&1 || useradd --system --home "$QUAY_DATA" --shell /usr/sbin/nologin quay
chown -R quay:quay "$QUAY_DATA"
chmod 0750 "$QUAY_DATA"   # token file is 0600; keep the dir owner-only too

echo "▸ writing systemd unit…"
cat > /etc/systemd/system/quay.service <<UNIT
[Unit]
Description=Quay deploy daemon
After=network.target

[Service]
User=quay
Environment=QUAY_DATA=${QUAY_DATA}
Environment=QUAY_PORT=7000
Environment=QUAY_BIND=127.0.0.1
Environment=QUAY_SCHEME=https
Environment=QUAY_PUBLIC_PORT=443
Environment=QUAY_ADMIN_HOST=quay.${QUAY_DOMAIN}
Environment=QUAY_DEPLOY_SUFFIX=quay.${QUAY_DOMAIN}
ExecStart=/usr/bin/node ${QUAY_DIR}/bin/quayd.js
Restart=always
RestartSec=2
StartLimitIntervalSec=60
# hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${QUAY_DATA}
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6
RestrictNamespaces=true

[Install]
WantedBy=multi-user.target
UNIT

echo "▸ writing Caddyfile…"
export QUAY_DOMAIN QUAY_ACME_EMAIL
envsubst < "$REPO_DIR/deploy/Caddyfile.tmpl" > /etc/caddy/Caddyfile

echo "▸ firewalling :7000 (defense-in-depth — only Caddy on loopback should reach it)…"
if command -v ufw >/dev/null; then ufw allow 80/tcp >/dev/null 2>&1 || true; ufw allow 443/tcp >/dev/null 2>&1 || true; ufw deny 7000/tcp >/dev/null 2>&1 || true; fi

systemctl daemon-reload
systemctl enable --now quay

echo "▸ waiting for quay to become healthy…"
for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:7000/healthz" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:7000/healthz" >/dev/null || { echo "✗ quay did not come up — check: journalctl -u quay"; exit 1; }

systemctl reload caddy || systemctl restart caddy

echo ""
echo "✓ Quay is up."
echo "  dashboard: https://quay.${QUAY_DOMAIN}"
echo "  token:     sudo -u quay cat ${QUAY_DATA}/config.json   (file is 0600)"
echo "  DNS:       point  *.quay.${QUAY_DOMAIN}  and  quay.${QUAY_DOMAIN}  at this server"
