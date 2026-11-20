// Prepares the database on API servers built by CloudFormation (infra/stockroom-architecture.yaml).
// Connects once as the RDS master user to create the app's own login role, then loads database/schema.sql
// as that role so the app owns its tables. The running API only ever uses the app role.
// Safe to run again, and on several servers at the same time.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { databaseSsl, readSecret } from '../db.js';

const { DB_HOST: host, DB_NAME: database, DB_SECRET_ARN: appSecretArn, MASTER_SECRET_ARN: masterSecretArn } = process.env;
if (!host || !database || !appSecretArn || !masterSecretArn) {
  console.error('Set DB_HOST, DB_NAME, DB_SECRET_ARN (app user) and MASTER_SECRET_ARN (RDS master user).');
  process.exit(1);
}

const port = Number(process.env.DB_PORT || 5432);
const ssl = databaseSsl();
const schema = readFileSync(new URL('../../database/schema.sql', import.meta.url), 'utf8');
const [master, app] = await Promise.all([readSecret(masterSecretArn), readSecret(appSecretArn)]);

const admin = new pg.Client({ host, port, database, user: master.username, password: master.password, ssl });
await admin.connect();
try {
  // API servers boot together; the lock makes them take turns. It is released when this session ends.
  await admin.query('SELECT pg_advisory_lock(7023)');
  const role = admin.escapeIdentifier(app.username);
  const { rowCount } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [app.username]);
  await admin.query(`${rowCount ? 'ALTER' : 'CREATE'} ROLE ${role} WITH LOGIN PASSWORD ${admin.escapeLiteral(app.password)}`);
  await admin.query(`GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(database)} TO ${role}`);
  await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${role}`);

  const appClient = new pg.Client({ host, port, database, user: app.username, password: app.password, ssl });
  await appClient.connect();
  try {
    await appClient.query(schema);
  } finally {
    await appClient.end();
  }
  console.log(`Database ready: role "${app.username}" owns the tables in "${database}".`);
} finally {
  await admin.end();
}
