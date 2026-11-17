# Three-instance CRUD demo

This project is split for deployment to three Linux instances. The browser only needs the frontend address: the frontend Node server serves the built React app and proxies `/api` requests to the private backend. The backend connects to PostgreSQL over the private network. The commands below assume Node.js 20 or newer is installed on the frontend and backend instances.

```text
Browser ──HTTP :8080──> Frontend instance ──private HTTP :4000──> Backend instance ──private PostgreSQL :5432──> Database instance
```

| Folder | Instance | Service |
| --- | --- | --- |
| `Frontend/` | Frontend | React static build + Node HTTP server/proxy |
| `backend/` | Backend | Express CRUD API |
| `database/` | Database | PostgreSQL schema and sample rows |

Use private IPs for backend and database traffic. Allow public inbound traffic only to the frontend port. On the backend, allow port `4000` only from the frontend instance. On the database, allow port `5432` only from the backend instance.

## 1. Database instance (Ubuntu)

Copy the `database/` folder to `/opt/crud/database` on this instance. Replace the example private IPs below with your actual addresses.

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql
```

At the PostgreSQL prompt, create the app role and database, using a strong password:

```sql
CREATE USER crud_app WITH PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
CREATE DATABASE crud_demo OWNER crud_app;
\q
```

Edit PostgreSQL's configuration (find the installed version under `/etc/postgresql/`):

```bash
sudo nano /etc/postgresql/<VERSION>/main/postgresql.conf
```

Set `listen_addresses` to the database instance's **private** IP:

```conf
listen_addresses = 'DB_PRIVATE_IP'
```

Add this line to `/etc/postgresql/<VERSION>/main/pg_hba.conf`, replacing `BACKEND_PRIVATE_IP`:

```conf
host    crud_demo    crud_app    BACKEND_PRIVATE_IP/32    scram-sha-256
```

Restart PostgreSQL, allow only the backend instance through the host firewall, and load the schema:

```bash
sudo systemctl restart postgresql
sudo ufw allow from BACKEND_PRIVATE_IP to any port 5432 proto tcp
PGPASSWORD='REPLACE_WITH_THE_SAME_PASSWORD' psql -h DB_PRIVATE_IP -U crud_app -d crud_demo -f /opt/crud/database/schema.sql
```

Also configure the cloud firewall/security group to allow TCP `5432` only from the backend instance's private IP. Do not expose PostgreSQL publicly.

## 2. Backend instance (Ubuntu)

Copy only the `backend/` folder to `/opt/crud/backend` on this instance. Install Node.js 20 or newer and verify with `node --version`, then run:

```bash
cd /opt/crud/backend
npm ci
export HOST=BACKEND_PRIVATE_IP
export PORT=4000
export DATABASE_URL='postgresql://crud_app:REPLACE_WITH_URL_ENCODED_PASSWORD@DB_PRIVATE_IP:5432/crud_demo'
npm start
```

The backend binds to its private interface. In the instance firewall/security group, allow TCP `4000` only from the frontend instance's private IP. Keep the process running with your service manager of choice. Check it from the backend instance with:

```bash
curl http://BACKEND_PRIVATE_IP:4000/api/health
```

The health response should include `"status":"ok"` and `"database":"connected"`.

## 3. Frontend instance (Ubuntu)

Copy only the `Frontend/` folder to `/opt/crud/Frontend` on this instance. Install Node.js 20 or newer and verify with `node --version`, then build and serve:

```bash
cd /opt/crud/Frontend
npm ci
npm run build
export HOST=0.0.0.0
export PORT=8080
export BACKEND_URL=http://BACKEND_PRIVATE_IP:4000
npm start
```

Allow public TCP `8080` to this instance (or choose `PORT=80` if running with the required privileges). Users browse to `http://FRONTEND_PUBLIC_IP:8080`. The browser calls same-origin `/api` routes; the frontend server forwards them to the backend over the private network. The backend IP is not placed in the React bundle.

## Local development

Run PostgreSQL locally and apply `database/schema.sql`, then start the API and Vite in separate terminals:

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
