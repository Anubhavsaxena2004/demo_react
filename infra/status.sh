#!/bin/bash
# Shows the app URL, the servers in each tier, and whether the load balancers consider them healthy.
#   ./status.sh [stack-name]
set -euo pipefail
STACK="${1:-stockroom}"
REGION="${AWS_REGION:-us-east-1}"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo "Stack status: $(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query 'Stacks[0].StackStatus' --output text)"
echo "App URL:      $(output AppUrl)"

for tier in Web Api; do
  echo
  echo "== $tier tier: Auto Scaling group $(output ${tier}AutoScalingGroupName)"
  aws autoscaling describe-auto-scaling-groups --region "$REGION" --auto-scaling-group-names "$(output ${tier}AutoScalingGroupName)" \
    --query 'AutoScalingGroups[0].Instances[].{Instance:InstanceId,Zone:AvailabilityZone,Lifecycle:LifecycleState,Health:HealthStatus}' \
    --output table
  echo "Load balancer view (healthy = serving traffic):"
  aws elbv2 describe-target-health --region "$REGION" --target-group-arn "$(output ${tier}TargetGroupArn)" \
    --query 'TargetHealthDescriptions[].{Instance:Target.Id,State:TargetHealth.State,Reason:TargetHealth.Reason}' \
    --output table
done
