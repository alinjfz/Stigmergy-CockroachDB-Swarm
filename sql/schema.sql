-- Stigmergy floor: state, locks, and 384-d scents in one CockroachDB.
-- Prefix-column vector index: warehouse_id is a pre-filter, not a post-filter.

CREATE TABLE IF NOT EXISTS warehouses (
  id STRING PRIMARY KEY,
  label STRING NOT NULL
);

INSERT INTO warehouses (id, label) VALUES
  ('default', 'Dock B / night wave'),
  ('floor-b', 'Isolation proof floor'),
  ('test', 'Integration test floor')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cells (
  warehouse_id STRING NOT NULL REFERENCES warehouses (id),
  x INT8 NOT NULL,
  y INT8 NOT NULL,
  package_id UUID NULL,
  reserved_by STRING NULL,
  reserved_at TIMESTAMPTZ NULL,
  PRIMARY KEY (warehouse_id, x, y)
);

CREATE TABLE IF NOT EXISTS packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id STRING NOT NULL REFERENCES warehouses (id),
  sku STRING NOT NULL,
  label STRING NOT NULL,
  x INT8 NOT NULL,
  y INT8 NOT NULL,
  dest_x INT8 NOT NULL,
  dest_y INT8 NOT NULL,
  status STRING NOT NULL DEFAULT 'waiting',
  claimed_by STRING NULL,
  claimed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS scents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id STRING NOT NULL,
  cell_x INT8 NOT NULL,
  cell_y INT8 NOT NULL,
  kind STRING NOT NULL,
  reason STRING NOT NULL,
  picker_id STRING NULL,
  wave INT8 NOT NULL DEFAULT 1,
  embedding VECTOR(384) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE VECTOR INDEX IF NOT EXISTS scents_embedding_idx ON scents (warehouse_id, embedding);

CREATE TABLE IF NOT EXISTS floor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id STRING NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  picker_id STRING NULL,
  event_type STRING NOT NULL,
  cell_x INT8 NULL,
  cell_y INT8 NULL,
  package_id UUID NULL,
  sql_text STRING NULL,
  payload JSONB NULL
);

CREATE INDEX IF NOT EXISTS floor_events_wh_at ON floor_events (warehouse_id, at DESC);

-- Durable picker loops so a serverless host can tick them on each request.
CREATE TABLE IF NOT EXISTS picker_loops (
  warehouse_id STRING NOT NULL,
  picker_id STRING NOT NULL,
  PRIMARY KEY (warehouse_id, picker_id)
);

CREATE TABLE IF NOT EXISTS floor_runtime (
  warehouse_id STRING PRIMARY KEY,
  recall_enabled BOOL NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS packages_wh_status ON packages (warehouse_id, status);
