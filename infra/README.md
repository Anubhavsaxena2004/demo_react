# Stockroom on a three-tier AWS architecture (CloudFormation)

`stockroom-architecture.yaml` builds the whole environment from one template, about 54 resources, in roughly 20 minutes, and deletes it again in one step. It runs the real Stockroom app from this repo; nothing is a placeholder.

The full walkthrough is the PDF guide in [`docs/`](../docs/Stockroom-AWS-CloudFormation-Guide.pdf). It covers deploying, building the same thing by hand in the console, a demo script and shutting everything down.

```text
Internet ──HTTP :80──> Public ALB (public subnets, 2 AZs)
                          │ :8080
                          ▼
                 Web Auto Scaling group (private subnets)    React build + /api proxy
                          │ :80
                          ▼
                 Internal ALB (private subnets)
                          │ :4000
                          ▼
                 API Auto Scaling group (private subnets) ──> S3 photos        (gateway endpoint)
                          │                               ──> SQS ─> worker ─> DynamoDB activity feed
                          │ :5432 TLS                     ──> Secrets Manager  (database logins)
                          ▼
                 RDS PostgreSQL, Multi-AZ (private DB subnets, no internet route)

Outbound internet for the servers (packages, GitHub): one NAT gateway. Shell access: Session Manager (no SSH, no public IPs).
```

| Layer | What the template creates |
| --- | --- |
| Network | VPC `10.0.0.0/16`; public, private-app and private-DB subnets in two AZs; internet gateway; NAT gateway; route tables; free S3 and DynamoDB gateway endpoints |
| Security | Five security groups chained so each tier only accepts the tier in front of it; one IAM role per tier scoped to this stack's resources; IMDSv2 only; encrypted disks, database, bucket and queues; S3 bucket refuses non-HTTPS requests |
| Compute | Two launch templates (Ubuntu 24.04) and two Auto Scaling groups (min 2, max 4, CPU target 50%), each behind its own Application Load Balancer |
| Data | RDS PostgreSQL (Multi-AZ, `db.t4g.micro`), private S3 bucket, DynamoDB table, SQS queue with a dead-letter queue, two Secrets Manager secrets |

At first boot each server clones this repo and runs [`scripts/setup-web.sh`](scripts/setup-web.sh) or [`scripts/setup-api.sh`](scripts/setup-api.sh). The API servers run [`backend/scripts/bootstrap-db.js`](../backend/scripts/bootstrap-db.js) once. It uses the master login to create the least-privilege `crud_app` database role and load the schema; after that the API only uses `crud_app`.

## Deploy

The servers clone the branch named in the `RepoBranch` parameter (default `feature/cloudformation-architecture`), so that branch must be pushed to GitHub first.

**AWS CloudShell** (console, top bar, terminal icon; region N. Virginia):

```bash
git clone -b feature/cloudformation-architecture https://github.com/Anubhavsaxena2004/demo_react.git
cd demo_react/infra
bash deploy.sh          # asks for the RDS master password; ~20 minutes
bash status.sh          # repeat until every target shows "healthy" (~5 more minutes)
```

**Console only:** CloudFormation, then Create stack, then With new resources. Upload `stockroom-architecture.yaml`, name the stack `stockroom` and enter the RDS master password. Tick "I acknowledge that AWS CloudFormation might create IAM resources" and submit. The app address is `AppUrl` on the stack's **Outputs** tab.

Optional parameter overrides, for example `EXTRA_PARAMS='DBMultiAZ=false MinSize=1 DesiredCapacity=1' bash deploy.sh`, roughly halve the cost of a practice run.

## Cost and shutting down

With the defaults it costs roughly **$0.20 per hour (about $5 per day)** in us-east-1 before any free tier. Most of that is the NAT gateway, two load balancers, the Multi-AZ database and four `t3.micro` servers. Delete it when you are done:

```bash
bash teardown.sh        # empties the photo bucket, deletes the stack, waits until it is gone
```

Nothing is kept after deletion: no final database snapshot, no retained bucket or table. Everything the stack created is tagged `Project=stockroom`, so Resource Groups & Tag Editor can confirm nothing is left.

## Troubleshooting

- **Stack rolled back:** open the stack's **Events** tab and read the first `CREATE_FAILED` row; the later failures are usually just consequences of it.
- **Targets stay unhealthy for more than 10 minutes:** EC2, select the instance, Connect, Session Manager. Then run `sudo tail -n 100 /var/log/cloud-init-output.log` and `sudo journalctl -u crud-backend -n 50` (or `crud-frontend`). EC2 > Actions > Monitor and troubleshoot > Get system log shows the same boot log without logging in.
- **502 from the load balancer** means the web servers are still installing; **503** means no healthy servers are registered yet.
