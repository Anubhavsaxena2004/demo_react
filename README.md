# Stockroom CRUD demo (EC2 + RDS + S3)

An inventory app where each product can have a photo. The browser only ever talks to the frontend: the frontend Node server serves the built React app and proxies `/api` requests to the private backend. The backend stores product data in Amazon RDS for PostgreSQL and photos in a private S3 bucket.

```text
Browser ──HTTP :80────> Frontend EC2 ──private HTTP :4000──> Backend EC2 ──private TLS :5432──> RDS PostgreSQL
                                                                 └────────HTTPS (IAM role)────> S3 bucket (private)
```

| Folder | Runs on | Purpose |
| --- | --- | --- |
| `Frontend/` | Frontend EC2 | React static build + Node HTTP server/proxy |
| `backend/` | Backend EC2 | Express CRUD API, photo upload to S3 |
| `database/` | RDS (applied from the backend EC2) | Schema and sample rows |

## How a photo upload works

1. The user picks a photo in the product form. React saves the product, then sends the photo to `POST /api/items/:id/image` (multipart field `image`).
2. The frontend server proxies the request over the private network to the backend.
3. The backend checks the file's first bytes (JPEG, PNG or WebP only, at most 5 MB) and uploads it to S3 as `items/<product id>/<random id>.<ext>`.
4. The backend saves only that S3 key in the `items.image_key` column in RDS, then deletes the product's previous photo from S3.
5. `GET /api/items` returns an `imageUrl` such as `/api/items/<id>/image?v=<random id>`. The browser loads it through the frontend, and the backend streams the file from S3.

The bucket has Block Public Access turned on and no bucket policy, so direct S3 URLs return `403 Access Denied`. The backend gets temporary S3 credentials from its EC2 IAM role; no access keys are stored anywhere.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/items` | List products (each with `imageUrl` or `null`) |
| POST | `/api/items` | Create a product |
| PUT | `/api/items/:id` | Update a product |
| DELETE | `/api/items/:id` | Delete a product and its photo |
| POST | `/api/items/:id/image` | Upload or replace a product photo |
| GET | `/api/items/:id/image` | Stream a product photo from S3 |
| DELETE | `/api/items/:id/image` | Remove a product photo |
| GET | `/api/health` | Check the API and database connection |

## AWS resources

- **S3 bucket** in the same region as the instances, Block Public Access on, default SSE-S3 encryption, no CORS or bucket policy needed.
- **IAM role** for EC2, attached to the backend instance only, with this inline policy:

  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/items/*"
    }]
  }
  ```

- **RDS for PostgreSQL**, not publicly accessible, in the same VPC, with "Connect to an EC2 compute resource" pointed at the backend instance so only the backend can reach port 5432.
- **Security groups:** frontend allows `80` (HTTP) from the internet; backend allows `4000` only from the frontend's security group.

## 1. Database (RDS), from the backend EC2

Install the PostgreSQL client and Amazon's RDS certificate bundle:

```bash
sudo apt install -y postgresql-client
sudo curl -fsSL -o /etc/ssl/certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

Connect as the RDS master user and create an app user and database:

```bash
psql "host=RDS_ENDPOINT port=5432 dbname=postgres user=postgres sslmode=verify-full sslrootcert=/etc/ssl/certs/rds-global-bundle.pem"
```

```sql
CREATE ROLE crud_app LOGIN PASSWORD 'REPLACE_WITH_A_PASSWORD';
GRANT crud_app TO postgres;
CREATE DATABASE crud_demo OWNER crud_app;  -- or: ALTER DATABASE crud_demo OWNER TO crud_app;
\q
```

Load the schema as the app user:

```bash
psql "host=RDS_ENDPOINT port=5432 dbname=crud_demo user=crud_app sslmode=verify-full sslrootcert=/etc/ssl/certs/rds-global-bundle.pem" -f /opt/crud/database/schema.sql
```

## 2. Backend EC2

Install Node.js 20 or newer, then:

```bash
cd /opt/crud/backend
npm ci --omit=dev
```

Create `/etc/crud-backend.env` (readable by root only, `chmod 600`):

```bash
HOST=BACKEND_PRIVATE_IP
PORT=4000
DATABASE_URL=postgresql://crud_app:URL_ENCODED_PASSWORD@RDS_ENDPOINT:5432/crud_demo
DATABASE_SSL=true
DATABASE_SSL_CA=/etc/ssl/certs/rds-global-bundle.pem
S3_BUCKET=YOUR_BUCKET
AWS_REGION=us-east-1
```

Run it as a systemd service (`EnvironmentFile=/etc/crud-backend.env`, `ExecStart=/usr/bin/node /opt/crud/backend/server.js`) and check it:

```bash
curl http://BACKEND_PRIVATE_IP:4000/api/health
```

The response should be `{"status":"ok","database":"connected"}`.

## 3. Frontend EC2

Install Node.js 20 or newer, then build and serve:

```bash
cd /opt/crud/Frontend
npm ci
npm run build
```

Create `/etc/crud-frontend.env`:

```bash
HOST=0.0.0.0
PORT=80
BACKEND_URL=http://BACKEND_PRIVATE_IP:4000
```

Run it as a systemd service as the unprivileged `ubuntu` user. Ports below 1024 need a capability, so grant only that one instead of running Node as root:

```ini
[Service]
User=ubuntu
EnvironmentFile=/etc/crud-frontend.env
ExecStart=/usr/bin/node /opt/crud/Frontend/server.js
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
```

Users browse to `http://FRONTEND_PUBLIC_IP` (no port needed). If the site previously ran on another port, add `REDIRECT_PORT=8080` to the env file (and keep that port open) so old links get a `301` redirect to the new address. Clicking a product photo opens it full size. The backend address is never placed in the React bundle.

## Updating a running deployment

```bash
# backend EC2
cd /opt/crud && git pull && cd backend && npm ci --omit=dev && sudo systemctl restart crud-backend
# frontend EC2
cd /opt/crud && git pull && cd Frontend && npm ci && npm run build && sudo systemctl restart crud-frontend
```

Logs: `sudo journalctl -u crud-backend -f` and `sudo journalctl -u crud-frontend -f`.

## Local development

Run PostgreSQL locally and apply `database/schema.sql`, then start the API and Vite in separate terminals. Photo uploads need `S3_BUCKET` and AWS credentials; without them the rest of the app works and photo routes return `503`.

```bash
cd backend
npm ci
DATABASE_URL='postgresql://crud_app:password@localhost:5432/crud_demo' npm run dev
```

```bash
cd Frontend
npm ci
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:4000` by default. Set `API_TARGET` if the local API listens elsewhere.
