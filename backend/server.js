import express from 'express';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 4000);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it to the private PostgreSQL connection string.');
  process.exit(1);
}

app.use(express.json({ limit: '32kb' }));

function validateItem(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const quantity = Number(body.quantity);
  const price = Number(body.price);

  if (!name || name.length > 80 || !category || category.length > 50 || !Number.isInteger(quantity) || quantity < 0 || !Number.isFinite(price) || price < 0) {
    return { error: 'Enter a name (up to 80 characters), category (up to 50 characters), non-negative whole quantity, and non-negative price.' };
  }

  return { item: { name, category, quantity, price } };
}

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/items', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, name, category, quantity, price::float8 AS price FROM items ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/items', async (req, res, next) => {
  try {
    const result = validateItem(req.body);
    if (result.error) return res.status(400).json({ message: result.error });
    const { name, category, quantity, price } = result.item;
    const { rows } = await pool.query(
      'INSERT INTO items (id, name, category, quantity, price) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, category, quantity, price::float8 AS price',
      [randomUUID(), name, category, quantity, price],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put('/api/items/:id', async (req, res, next) => {
  try {
    const result = validateItem(req.body);
    if (result.error) return res.status(400).json({ message: result.error });
    const { name, category, quantity, price } = result.item;
    const { rows } = await pool.query(
      'UPDATE items SET name = $1, category = $2, quantity = $3, price = $4, updated_at = NOW() WHERE id = $5 RETURNING id, name, category, quantity, price::float8 AS price',
      [name, category, quantity, price, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Item not found.' });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/items/:id', async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Item not found.' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Something went wrong while accessing the inventory.' });
});

const server = app.listen(port, host, () => console.log(`CRUD API listening on http://${host}:${port}`));

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
