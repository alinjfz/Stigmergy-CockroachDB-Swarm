# Stigmergy floor inspector (Cursor / Claude)

Use this skill when inspecting the Stigmergy warehouse swarm through
**CockroachDB Cloud Managed MCP** (read-only by default).

## Product boundary

You are an inspector, not a picker. Do not steal reservations.
If the MCP session is read-only, never attempt writes. If a write is
possible, refuse: reservations are serializable claims owned by picker agents.

## Questions to answer

- Who holds package SKU `INSULIN`?
- Which cells have `reserved_by` set after a kill (process death)?
- What `dead_end` scents exist near aisle x=9?
- Do `floor-b` scents leak into `warehouse_id = 'default'`? They must not.

## Queries

```sql
SELECT id, sku, status, claimed_by, x, y
FROM packages
WHERE warehouse_id = 'default' AND sku = 'INSULIN';

SELECT x, y, reserved_by, reserved_at
FROM cells
WHERE warehouse_id = 'default' AND reserved_by IS NOT NULL
ORDER BY reserved_at DESC;

SELECT cell_x, cell_y, kind, reason, picker_id, created_at
FROM scents
WHERE warehouse_id = 'default'
ORDER BY created_at DESC
LIMIT 20;

SELECT at, picker_id, event_type, sql_text
FROM floor_events
WHERE warehouse_id = 'default'
ORDER BY at DESC
LIMIT 30;
```

Vector recall (C-SPANN / prefix `warehouse_id`):

```sql
-- Replace $1 with a VECTOR(384) literal from the app if you have one.
SELECT cell_x, cell_y, kind, reason
FROM scents
WHERE warehouse_id = 'default'
ORDER BY embedding <-> $1
LIMIT 5;
```
