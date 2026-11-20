#!/bin/bash
# Deletes everything the stack created so billing stops: servers, load balancers, NAT gateway, database (no final
# snapshot), photos, queue and table. S3 refuses to delete a bucket that still has objects, so it is emptied first.
#   ./teardown.sh [stack-name]
set -euo pipefail
STACK="${1:-stockroom}"
REGION="${AWS_REGION:-us-east-1}"

BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='MediaBucketName'].OutputValue" --output text)

echo "This permanently deletes stack '$STACK' in $REGION, including the database, every product photo and the activity feed."
read -rp "Type the stack name to confirm: " answer
[ "$answer" = "$STACK" ] || { echo 'Cancelled - nothing was deleted.'; exit 1; }

if [ -n "$BUCKET" ] && [ "$BUCKET" != "None" ]; then
  echo "Emptying s3://$BUCKET ..."
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGION"
fi

aws cloudformation delete-stack --stack-name "$STACK" --region "$REGION"
echo 'Deleting... this takes about 10-20 minutes (the database and NAT gateway are the slowest).'
aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$REGION"
echo "Stack '$STACK' is deleted. Check Billing > Bills over the next day to confirm charges have stopped."
