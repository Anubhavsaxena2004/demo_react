#!/bin/bash
# Shared first-boot steps for setup-web.sh and setup-api.sh (sourced, not run directly). Ubuntu 24.04/26.04, as root.
#   - a 1 GB swap file so `npm ci` fits on a 1 GB t3.micro
#   - Node.js 24 from NodeSource
#   - this instance's ID and Availability Zone, which the app displays to show load balancing
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive HOME="${HOME:-/root}"
APP_DIR="${APP_DIR:-/opt/crud}"
APT="apt-get -y -o DPkg::Lock::Timeout=600"

# Package mirrors and npm occasionally time out right after boot; try a few times before failing.
retry() {
  local attempt
  for attempt in 1 2 3 4 5; do
    "$@" && return 0
    echo "Attempt $attempt failed: $*" >&2
    sleep $((attempt * 10))
  done
  return 1
}

if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  install -d -m 0755 /etc/apt/keyrings
  retry curl -fsSL -o /etc/apt/keyrings/nodesource.asc https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key
  echo 'deb [signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_24.x nodistro main' \
    > /etc/apt/sources.list.d/nodesource.list
  retry $APT update
  retry $APT install nodejs
fi

# IMDSv2 (required by the launch template): fetch a short-lived token, then read the metadata value.
imds() {
  local token
  token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
  curl -fsS -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/meta-data/$1"
}
INSTANCE_ID=$(imds instance-id)
AVAILABILITY_ZONE=$(imds placement/availability-zone)

chown -R ubuntu:ubuntu "$APP_DIR"
