import { readFileSync } from 'node:fs';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

// RDS requires TLS. DATABASE_SSL_CA points at Amazon's RDS certificate bundle so the server certificate is verified.
export function databaseSsl() {
  if (process.env.DATABASE_SSL !== 'true') return undefined;
  const caFile = process.env.DATABASE_SSL_CA;
  return { rejectUnauthorized: true, ...(caFile && { ca: readFileSync(caFile, 'utf8') }) };
}

// Secrets hold {"username": "...", "password": "..."}. The EC2 instance's IAM role is what allows the read,
// so no password is ever written to the server's disk.
export async function readSecret(secretId) {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  return JSON.parse(SecretString);
}

// Two ways to point the API at PostgreSQL:
//  - DATABASE_URL: the hand-built servers described in README.md
//  - DB_HOST + DB_NAME + DB_SECRET_ARN: the CloudFormation stack in infra/, where the password lives in Secrets Manager
export async function databaseConfig() {
  const ssl = databaseSsl();
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ssl };

  const { DB_HOST: host, DB_NAME: database, DB_SECRET_ARN: secretArn } = process.env;
  if (!host || !database || !secretArn) {
    throw new Error('Database is not configured. Set DATABASE_URL, or DB_HOST, DB_NAME and DB_SECRET_ARN.');
  }
  const { username: user, password } = await readSecret(secretArn);
  return { host, port: Number(process.env.DB_PORT || 5432), database, user, password, ssl };
}
