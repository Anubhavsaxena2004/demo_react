import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { activityEnabled, listActivity, recordActivity, startActivityWorker } from './activity.js';
import { databaseConfig } from './db.js';

const { Pool } = pg;
const app = express();
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 4000);
const bucket = process.env.S3_BUCKET;
const maxImageBytes = 5 * 1024 * 1024;
// Set by the CloudFormation launch template; the app shows it so you can watch the load balancer switch servers.
const instance = process.env.INSTANCE_ID ? { id: process.env.INSTANCE_ID, zone: process.env.AVAILABILITY_ZONE || null } : null;

let pool;
try {
  pool = new Pool(await databaseConfig());
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
// Credentials come from the EC2 instance's IAM role; no access keys are stored on the server.
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxImageBytes, files: 1 } });
const columns = 'id, name, category, quantity, price::float8 AS price, image_key';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// The browser never sees S3 keys; it gets a same-origin URL. The version changes on every upload so old photos are never cached.
function toItem({ image_key: imageKey, ...item }) {
  const version = imageKey ? imageKey.split('/').pop().split('.')[0] : null;
  return { ...item, imageUrl: imageKey ? `/api/items/${item.id}/image?v=${version}` : null };
}

// Trust the file's first bytes, not the MIME type the browser claims.
function detectImage(buffer) {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a) return { ext: 'png', type: 'image/png' };
  if (buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

async function deleteStoredImage(key) {
  if (!key || !bucket) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    console.error(`Could not delete s3://${bucket}/${key}: ${error.message}`);
  }
}

// Swaps the stored key in one statement and returns the key it replaced, so concurrent uploads never orphan an S3 object.
async function replaceImageKey(id, key) {
  const { rows } = await pool.query(
    `UPDATE items AS i SET image_key = $1, updated_at = NOW()
     FROM (SELECT id, image_key FROM items WHERE id = $2 FOR UPDATE) AS previous
     WHERE i.id = previous.id
     RETURNING i.id, i.name, i.category, i.quantity, i.price::float8 AS price, i.image_key, previous.image_key AS previous_key`,
    [key, id],
  );
  if (!rows[0]) return null;
  const { previous_key: previousKey, ...row } = rows[0];
  return { item: toItem(row), previousKey };
}

function requireStorage(_req, res, next) {
  if (!bucket) return res.status(503).json({ message: 'Image storage is not configured on the server.' });
  next();
}

app.param('id', (_req, res, next, id) => (uuidPattern.test(id) ? next() : res.status(404).json({ message: 'Item not found.' })));

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', instance });
  } catch (error) {
    next(error);
  }
});

app.get('/api/activity', async (_req, res, next) => {
  if (!activityEnabled) return res.status(503).json({ message: 'The activity feed is not configured on the server.' });
  try {
    res.set('cache-control', 'no-store').json(await listActivity());
  } catch (error) {
    next(error);
  }
});

app.get('/api/items', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ${columns} FROM items ORDER BY created_at DESC`);
    res.json(rows.map(toItem));
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
      `INSERT INTO items (id, name, category, quantity, price) VALUES ($1, $2, $3, $4, $5) RETURNING ${columns}`,
      [randomUUID(), name, category, quantity, price],
    );
    await recordActivity('created', rows[0]);
    res.status(201).json(toItem(rows[0]));
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
      `UPDATE items SET name = $1, category = $2, quantity = $3, price = $4, updated_at = NOW() WHERE id = $5 RETURNING ${columns}`,
      [name, category, quantity, price, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Item not found.' });
    await recordActivity('updated', rows[0]);
    res.json(toItem(rows[0]));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/items/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM items WHERE id = $1 RETURNING id, name, image_key', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ message: 'Item not found.' });
    await deleteStoredImage(rows[0].image_key);
    await recordActivity('deleted', rows[0]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// Upload flow: browser -> frontend proxy -> here -> S3 (file) -> PostgreSQL (key only).
app.post('/api/items/:id/image', requireStorage, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Choose an image to upload.' });
    const image = detectImage(req.file.buffer);
    if (!image) return res.status(400).json({ message: 'Only JPEG, PNG and WebP images are supported.' });

    const exists = await pool.query('SELECT 1 FROM items WHERE id = $1', [req.params.id]);
    if (!exists.rowCount) return res.status(404).json({ message: 'Item not found.' });

    const key = `items/${req.params.id}/${randomUUID()}.${image.ext}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: req.file.buffer, ContentType: image.type }));

    const result = await replaceImageKey(req.params.id, key);
    if (!result) {
      await deleteStoredImage(key);
      return res.status(404).json({ message: 'Item not found.' });
    }
    await deleteStoredImage(result.previousKey);
    await recordActivity('photo-added', result.item);
    res.json(result.item);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/items/:id/image', requireStorage, async (req, res, next) => {
  try {
    const result = await replaceImageKey(req.params.id, null);
    if (!result) return res.status(404).json({ message: 'Item not found.' });
    await deleteStoredImage(result.previousKey);
    if (result.previousKey) await recordActivity('photo-removed', result.item);
    res.json(result.item);
  } catch (error) {
    next(error);
  }
});

// The bucket stays private: images are streamed through the backend instead of being exposed with public S3 URLs.
app.get('/api/items/:id/image', requireStorage, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT image_key FROM items WHERE id = $1', [req.params.id]);
    const key = rows[0]?.image_key;
    if (!key) return res.status(404).json({ message: 'Image not found.' });

    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    res.set({
      'content-type': object.ContentType || 'application/octet-stream',
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    });
    if (object.ContentLength !== undefined) res.set('content-length', String(object.ContentLength));
    await pipeline(object.Body, res);
  } catch (error) {
    if (error.name === 'NoSuchKey') return res.status(404).json({ message: 'Image not found.' });
    if (res.headersSent) return res.destroy();
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Images must be 5 MB or smaller.' : 'Upload a single image in the "image" field.';
    return res.status(400).json({ message });
  }
  console.error(error);
  res.status(500).json({ message: 'Something went wrong while accessing the inventory.' });
});

const server = app.listen(port, host, () => {
  console.log(`CRUD API listening on http://${host}:${port}; image bucket: ${bucket || 'not configured'}`);
});
const stopActivityWorker = startActivityWorker();

async function shutdown() {
  stopActivityWorker();
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
