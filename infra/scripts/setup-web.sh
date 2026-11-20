#!/bin/bash
# Web tier: builds the React app and serves it on port 8080 with Frontend/server.js.
# The public load balancer sends browsers here; /api requests are proxied to BACKEND_URL (the internal load balancer).
#
# Run as root after cloning the repo to /opt/crud:
#   BACKEND_URL=http://<internal-load-balancer-DNS> bash /opt/crud/infra/scripts/setup-web.sh
set -euo pipefail
: "${BACKEND_URL:?Set BACKEND_URL to the internal load balancer, for example http://internal-stockroom-api-123.us-east-1.elb.amazonaws.com}"
source "$(dirname "$0")/setup-common.sh"

retry sudo -u ubuntu -H bash -c "cd '$APP_DIR/Frontend' && npm ci --no-audit --no-fund"
sudo -u ubuntu -H bash -c "cd '$APP_DIR/Frontend' && npm run build"

cat > /etc/crud-frontend.env <<EOF
HOST=0.0.0.0
PORT=8080
BACKEND_URL=$BACKEND_URL
INSTANCE_ID=$INSTANCE_ID
AVAILABILITY_ZONE=$AVAILABILITY_ZONE
NODE_ENV=production
EOF

cat > /etc/systemd/system/crud-frontend.service <<EOF
[Unit]
Description=Stockroom web tier (React build and API proxy)
After=network-online.target
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=$APP_DIR/Frontend
EnvironmentFile=/etc/crud-frontend.env
ExecStart=/usr/bin/node $APP_DIR/Frontend/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable crud-frontend
systemctl restart crud-frontend
echo "Web tier ready on port 8080 ($INSTANCE_ID, $AVAILABILITY_ZONE); API proxy -> $BACKEND_URL"
