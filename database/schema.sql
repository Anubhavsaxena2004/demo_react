CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  category VARCHAR(50) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  image_key VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The image file lives in S3; only its object key is stored here.
-- Adds the column to databases created before image uploads existed.
ALTER TABLE items ADD COLUMN IF NOT EXISTS image_key VARCHAR(255);

INSERT INTO items (id, name, category, quantity, price)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Wireless headphones', 'Electronics', 12, 89.99),
  ('10000000-0000-4000-8000-000000000002', 'Desk lamp', 'Home', 8, 34.50),
  ('10000000-0000-4000-8000-000000000003', 'Notebook set', 'Stationery', 25, 12.75)
ON CONFLICT (id) DO NOTHING;
