#!/bin/bash
# Creates the stack, or updates it if it already exists. Run it in AWS CloudShell (it already has the AWS CLI and
# your console login) or any shell with AWS CLI v2 credentials.
#
#   ./deploy.sh [stack-name]                      asks for the RDS master password
#   DB_PASSWORD=... ./deploy.sh                   non-interactive
#   EXTRA_PARAMS='DBMultiAZ=false' ./deploy.sh    any other parameter overrides (space separated)
set -euo pipefail
STACK="${1:-stockroom}"
REGION="${AWS_REGION:-us-east-1}"
cd "$(dirname "$0")"

echo "Account: $(aws sts get-caller-identity --query Account --output text)  Region: $REGION  Stack: $STACK"

# A new stack needs the password. An existing stack keeps its stored values unless you override them.
if ! aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" >/dev/null 2>&1 && [ -z "${DB_PASSWORD:-}" ]; then
  read -rsp 'RDS master password (8+ characters, no / @ " or spaces): ' DB_PASSWORD
  echo
fi
overrides=()
if [ -n "${DB_PASSWORD:-}" ]; then overrides+=("DBMasterPassword=$DB_PASSWORD"); fi
read -ra extra <<< "${EXTRA_PARAMS:-}"
overrides+=("${extra[@]}")

aws cloudformation validate-template --region "$REGION" --template-body file://stockroom-architecture.yaml >/dev/null
echo 'Template is valid. Deploying - a new stack takes about 15-25 minutes (the Multi-AZ database is the slow part)...'

args=(--region "$REGION" --stack-name "$STACK" --template-file stockroom-architecture.yaml
  --capabilities CAPABILITY_IAM --tags Project=stockroom --no-fail-on-empty-changeset)
if [ ${#overrides[@]} -gt 0 ]; then args+=(--parameter-overrides "${overrides[@]}"); fi
aws cloudformation deploy "${args[@]}"

aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query 'Stacks[0].Outputs' --output table
echo 'The servers need about 5 more minutes to install the app. Run ./status.sh until every target is "healthy".'
