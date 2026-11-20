#!/bin/bash
# API tier: installs the Express API, prepares the database, and runs the API on port 4000 behind the internal
# load balancer. No password is written to disk: the API reads its database login from Secrets Manager using the
# instance's IAM role.
#
# Run as root after cloning the repo to /opt/crud, with these variables set (the launch template does this):
#   AWS_REGION DB_HOST DB_NAME DB_SECRET_ARN MASTER_SECRET_ARN S3_BUCKET ACTIVITY_QUEUE_URL ACTIVITY_TABLE [DB_PORT]
set -euo pipefail
for name in AWS_REGION DB_HOST DB_NAME DB_SECRET_ARN MASTER_SECRET_ARN S3_BUCKET ACTIVITY_QUEUE_URL ACTIVITY_TABLE; do
  [ -n "${!name:-}" ] || { echo "Set $name before running this script." >&2; exit 1; }
done
source "$(dirname "$0")/setup-common.sh"

# psql is not needed by the app; it is installed so you can show the tables during a demo.
retry $APT install postgresql-client
retry curl -fsSL -o /etc/ssl/certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
retry sudo -u ubuntu -H bash -c "cd '$APP_DIR/backend' && npm ci --omit=dev --no-audit --no-fund"

cat > /etc/crud-backend.env <<EOF
HOST=0.0.0.0
PORT=4000
AWS_REGION=$AWS_REGION
DB_HOST=$DB_HOST
DB_PORT=${DB_PORT:-5432}
DB_NAME=$DB_NAME
DB_SECRET_ARN=$DB_SECRET_ARN
DATABASE_SSL=true
DATABASE_SSL_CA=/etc/ssl/certs/rds-global-bundle.pem
S3_BUCKET=$S3_BUCKET
ACTIVITY_QUEUE_URL=$ACTIVITY_QUEUE_URL
ACTIVITY_TABLE=$ACTIVITY_TABLE
INSTANCE_ID=$INSTANCE_ID
AVAILABILITY_ZONE=$AVAILABILITY_ZONE
NODE_ENV=production
EOF
chmod 600 /etc/crud-backend.env

# One-time database setup with the master login: creates the app's own role and loads database/schema.sql.
(set -a; . /etc/crud-backend.env; set +a; retry env MASTER_SECRET_ARN="$MASTER_SECRET_ARN" node "$APP_DIR/backend/scripts/bootstrap-db.js")

cat > /etc/systemd/system/crud-backend.service <<EOF
[Unit]
Description=Stockroom API tier (Express, RDS, S3, SQS, DynamoDB)
After=network-online.target
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=/etc/crud-backend.env
ExecStart=/usr/bin/node $APP_DIR/backend/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable crud-backend
systemctl restart crud-backend
echo "API tier ready on port 4000 ($INSTANCE_ID, $AVAILABILITY_ZONE)"
