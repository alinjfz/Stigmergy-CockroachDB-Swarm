import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { GRID_HEIGHT, GRID_WIDTH, SEED_PACKAGES } from "./config";
import { embeddingLiteral } from "./embed";
import { recallEnabled } from "./recall";
import type { Store } from "./store";
import type {
  Cell,
  ClaimResult,
  FloorCounts,
  FloorEvent,
  FloorSnapshot,
  Package,
  Scent,
} from "./types";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 12,
      ssl: process.env.DATABASE_URL.includes("sslmode=disable")
        ? undefined
        : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function withSerializable<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

function mapCell(r: Record<string, unknown>): Cell {
  return {
    warehouse_id: String(r.warehouse_id),
    x: Number(r.x),
    y: Number(r.y),
    package_id: r.package_id ? String(r.package_id) : null,
    reserved_by: r.reserved_by ? String(r.reserved_by) : null,
    reserved_at: r.reserved_at ? new Date(String(r.reserved_at)).toISOString() : null,
  };
}

function mapPkg(r: Record<string, unknown>): Package {
  return {
    id: String(r.id),
    warehouse_id: String(r.warehouse_id),
    sku: String(r.sku),
    label: String(r.label),
    x: Number(r.x),
    y: Number(r.y),
    dest_x: Number(r.dest_x),
    dest_y: Number(r.dest_y),
    status: r.status as Package["status"],
    claimed_by: r.claimed_by ? String(r.claimed_by) : null,
    claimed_at: r.claimed_at ? new Date(String(r.claimed_at)).toISOString() : null,
  };
}

function parseVector(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === "string") {
    return raw
      .replace(/^[\[\(]/, "")
      .replace(/[\]\)]$/, "")
      .split(",")
      .map((s) => Number(s.trim()));
  }
  return [];
}

function mapScent(r: Record<string, unknown>): Scent {
  return {
    id: String(r.id),
    warehouse_id: String(r.warehouse_id),
    cell_x: Number(r.cell_x),
    cell_y: Number(r.cell_y),
    kind: r.kind as Scent["kind"],
    reason: String(r.reason),
    picker_id: r.picker_id ? String(r.picker_id) : null,
    wave: Number(r.wave ?? 1),
    embedding: parseVector(r.embedding),
    created_at: new Date(String(r.created_at)).toISOString(),
  };
}

function mapEvent(r: Record<string, unknown>): FloorEvent {
  return {
    id: String(r.id),
    warehouse_id: String(r.warehouse_id),
    at: new Date(String(r.at)).toISOString(),
    picker_id: r.picker_id ? String(r.picker_id) : null,
    event_type: String(r.event_type),
    cell_x: r.cell_x === null || r.cell_x === undefined ? null : Number(r.cell_x),
    cell_y: r.cell_y === null || r.cell_y === undefined ? null : Number(r.cell_y),
    package_id: r.package_id ? String(r.package_id) : null,
    sql_text: r.sql_text ? String(r.sql_text) : null,
    payload:
      r.payload && typeof r.payload === "object"
        ? (r.payload as Record<string, unknown>)
        : null,
  };
}

export class CockroachStore implements Store {
  kind = "cockroach" as const;

  async ensureRuntimeTables(): Promise<void> {
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS picker_loops (
        warehouse_id STRING NOT NULL,
        picker_id STRING NOT NULL,
        PRIMARY KEY (warehouse_id, picker_id)
      )`);
    await p.query(`
      CREATE TABLE IF NOT EXISTS floor_runtime (
        warehouse_id STRING PRIMARY KEY,
        recall_enabled BOOL NOT NULL DEFAULT true
      )`);
  }

  async listPickerLoops(warehouseId: string): Promise<string[]> {
    await this.ensureRuntimeTables();
    const r = await getPool().query(
      "SELECT picker_id FROM picker_loops WHERE warehouse_id = $1 ORDER BY picker_id",
      [warehouseId],
    );
    return r.rows.map((row) => String(row.picker_id));
  }

  async addPickerLoops(warehouseId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ensureRuntimeTables();
    const values = ids.map((_, i) => `($1, $${i + 2})`).join(",");
    await getPool().query(
      `INSERT INTO picker_loops (warehouse_id, picker_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      [warehouseId, ...ids],
    );
  }

  async removePickerLoops(warehouseId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ensureRuntimeTables();
    await getPool().query(
      `DELETE FROM picker_loops WHERE warehouse_id = $1 AND picker_id = ANY($2::STRING[])`,
      [warehouseId, ids],
    );
  }

  async setRecallFlag(warehouseId: string, on: boolean): Promise<void> {
    await this.ensureRuntimeTables();
    await getPool().query(
      `INSERT INTO floor_runtime (warehouse_id, recall_enabled) VALUES ($1, $2)
       ON CONFLICT (warehouse_id) DO UPDATE SET recall_enabled = EXCLUDED.recall_enabled`,
      [warehouseId, on],
    );
  }

  async getRecallFlag(warehouseId: string): Promise<boolean> {
    await this.ensureRuntimeTables();
    const r = await getPool().query(
      "SELECT recall_enabled FROM floor_runtime WHERE warehouse_id = $1",
      [warehouseId],
    );
    if (!r.rows[0]) return true;
    return r.rows[0].recall_enabled !== false;
  }

  async ensureSeeded(warehouseId: string): Promise<void> {
    await this.ensureRuntimeTables();
    await withSerializable(async (c) => {
      const count = await c.query("SELECT count(*)::int AS n FROM cells WHERE warehouse_id = $1", [
        warehouseId,
      ]);
      if (Number(count.rows[0].n) > 0) return;

      await c.query("INSERT INTO warehouses (id, label) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [
        warehouseId,
        warehouseId,
      ]);

      const values: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          values.push(`($${i++}, $${i++}, $${i++})`);
          params.push(warehouseId, x, y);
        }
      }
      await c.query(
        `INSERT INTO cells (warehouse_id, x, y) VALUES ${values.join(",")}`,
        params,
      );

      for (const p of SEED_PACKAGES) {
        const ins = await c.query(
          `INSERT INTO packages (warehouse_id, sku, label, x, y, dest_x, dest_y, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'waiting') RETURNING id`,
          [warehouseId, p.sku, p.label, p.x, p.y, p.dest_x, p.dest_y],
        );
        const id = ins.rows[0].id;
        await c.query(
          `UPDATE cells SET package_id = $1 WHERE warehouse_id = $2 AND x = $3 AND y = $4`,
          [id, warehouseId, p.x, p.y],
        );
      }
    });
  }

  async snapshot(warehouseId: string, livePickers: string[]): Promise<FloorSnapshot> {
    await this.ensureSeeded(warehouseId);
    const p = getPool();
    const [cells, packages, scents, events, counts] = await Promise.all([
      p.query("SELECT * FROM cells WHERE warehouse_id = $1", [warehouseId]),
      p.query("SELECT * FROM packages WHERE warehouse_id = $1", [warehouseId]),
      p.query("SELECT * FROM scents WHERE warehouse_id = $1 ORDER BY created_at DESC LIMIT 200", [
        warehouseId,
      ]),
      p.query("SELECT * FROM floor_events WHERE warehouse_id = $1 ORDER BY at DESC LIMIT 80", [
        warehouseId,
      ]),
      this.counts(warehouseId),
    ]);
    return {
      warehouseId,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      cells: cells.rows.map(mapCell),
      packages: packages.rows.map(mapPkg),
      scents: scents.rows.map(mapScent),
      events: events.rows.map(mapEvent),
      livePickers,
      wave: 1,
      store: "cockroach",
      counts,
      recallEnabled:
        process.env.VERCEL === "1" ? await this.getRecallFlag(warehouseId) : recallEnabled(),
    };
  }

  async counts(warehouseId: string): Promise<FloorCounts> {
    const r = await getPool().query(
      `SELECT
         (SELECT count(*)::int FROM floor_events WHERE warehouse_id = $1) AS events,
         (SELECT count(*)::int FROM scents WHERE warehouse_id = $1) AS scents,
         (SELECT count(*)::int FROM floor_events
            WHERE warehouse_id = $1 AND event_type = 'dead_end') AS dead_ends,
         (SELECT count(*)::int FROM floor_events
            WHERE warehouse_id = $1 AND event_type = 'jam') AS jams,
         (SELECT count(*)::int FROM floor_events
            WHERE warehouse_id = $1
              AND event_type IN ('dead_end', 'jam')
              AND at > now() - INTERVAL '30 seconds') AS failed_recent`,
      [warehouseId],
    );
    const row = r.rows[0] ?? {};
    return {
      events: Number(row.events ?? 0),
      scents: Number(row.scents ?? 0),
      deadEnds: Number(row.dead_ends ?? 0),
      jams: Number(row.jams ?? 0),
      failedClaimsRecent: Number(row.failed_recent ?? 0),
      messages: 0,
    };
  }

  async getCells(warehouseId: string): Promise<Cell[]> {
    const r = await getPool().query("SELECT * FROM cells WHERE warehouse_id = $1", [warehouseId]);
    return r.rows.map(mapCell);
  }

  async getPackages(warehouseId: string): Promise<Package[]> {
    const r = await getPool().query("SELECT * FROM packages WHERE warehouse_id = $1", [warehouseId]);
    return r.rows.map(mapPkg);
  }

  async positionOf(warehouseId: string, pickerId: string): Promise<Cell | null> {
    const r = await getPool().query(
      "SELECT * FROM cells WHERE warehouse_id = $1 AND reserved_by = $2 LIMIT 1",
      [warehouseId, pickerId],
    );
    return r.rows[0] ? mapCell(r.rows[0]) : null;
  }

  async heldBy(warehouseId: string, pickerId: string): Promise<Package | null> {
    const r = await getPool().query(
      `SELECT * FROM packages WHERE warehouse_id = $1 AND claimed_by = $2 AND status = 'claimed' LIMIT 1`,
      [warehouseId, pickerId],
    );
    return r.rows[0] ? mapPkg(r.rows[0]) : null;
  }

  async claimCell(warehouseId: string, x: number, y: number, pickerId: string): Promise<ClaimResult> {
    return withSerializable(async (c) => {
      const r = await c.query(
        `UPDATE cells SET reserved_by = $1, reserved_at = now()
         WHERE warehouse_id = $2 AND x = $3 AND y = $4 AND reserved_by IS NULL
         RETURNING *`,
        [pickerId, warehouseId, x, y],
      );
      if (r.rowCount === 0) {
        const exists = await c.query(
          `SELECT * FROM cells WHERE warehouse_id = $1 AND x = $2 AND y = $3`,
          [warehouseId, x, y],
        );
        if (!exists.rows[0]) return { ok: false as const, reason: "missing" as const };
        return { ok: false as const, reason: "occupied" as const };
      }
      return { ok: true as const, cell: mapCell(r.rows[0]) };
    });
  }

  async releaseCell(warehouseId: string, pickerId: string): Promise<void> {
    await getPool().query(
      `UPDATE cells SET reserved_by = NULL, reserved_at = NULL
       WHERE warehouse_id = $1 AND reserved_by = $2`,
      [warehouseId, pickerId],
    );
  }

  async movePicker(
    warehouseId: string,
    pickerId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<ClaimResult> {
    return withSerializable(async (c) => {
      const dest = await c.query(
        `UPDATE cells SET reserved_by = $1, reserved_at = now()
         WHERE warehouse_id = $2 AND x = $3 AND y = $4
           AND (reserved_by IS NULL OR reserved_by = $1)
         RETURNING *`,
        [pickerId, warehouseId, to.x, to.y],
      );
      if (dest.rowCount === 0) {
        return { ok: false as const, reason: "occupied" as const };
      }
      if (from.x !== to.x || from.y !== to.y) {
        await c.query(
          `UPDATE cells SET reserved_by = NULL, reserved_at = NULL
           WHERE warehouse_id = $1 AND x = $2 AND y = $3 AND reserved_by = $4`,
          [warehouseId, from.x, from.y, pickerId],
        );
      }
      return { ok: true as const, cell: mapCell(dest.rows[0]) };
    });
  }

  async addPackage(
    warehouseId: string,
    spec: { sku: string; label: string; x: number; y: number; dest_x: number; dest_y: number },
  ): Promise<Package> {
    return withSerializable(async (c) => {
      const ins = await c.query(
        `INSERT INTO packages (warehouse_id, sku, label, x, y, dest_x, dest_y, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'waiting') RETURNING *`,
        [warehouseId, spec.sku, spec.label, spec.x, spec.y, spec.dest_x, spec.dest_y],
      );
      const row = mapPkg(ins.rows[0]);
      await c.query(`UPDATE cells SET package_id = $1 WHERE warehouse_id = $2 AND x = $3 AND y = $4`, [
        row.id,
        warehouseId,
        spec.x,
        spec.y,
      ]);
      return row;
    });
  }

  async claimPackage(warehouseId: string, packageId: string, pickerId: string): Promise<boolean> {
    return withSerializable(async (c) => {
      const r = await c.query(
        `UPDATE packages SET claimed_by = $1, claimed_at = now(), status = 'claimed'
         WHERE id = $2 AND warehouse_id = $3 AND status = 'waiting' AND claimed_by IS NULL
         RETURNING id`,
        [pickerId, packageId, warehouseId],
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  async deliverPackage(warehouseId: string, packageId: string, pickerId: string): Promise<void> {
    await withSerializable(async (c) => {
      const r = await c.query(
        `UPDATE packages SET status = 'delivered'
         WHERE id = $1 AND warehouse_id = $2 AND claimed_by = $3
         RETURNING x, y`,
        [packageId, warehouseId, pickerId],
      );
      if (r.rows[0]) {
        await c.query(
          `UPDATE cells SET package_id = NULL
           WHERE warehouse_id = $1 AND x = $2 AND y = $3 AND package_id = $4`,
          [warehouseId, r.rows[0].x, r.rows[0].y, packageId],
        );
      }
    });
  }

  async insertScent(scent: Omit<Scent, "id" | "created_at">): Promise<Scent> {
    const lit = embeddingLiteral(scent.embedding);
    const r = await getPool().query(
      `INSERT INTO scents (warehouse_id, cell_x, cell_y, kind, reason, picker_id, wave, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)
       RETURNING *`,
      [
        scent.warehouse_id,
        scent.cell_x,
        scent.cell_y,
        scent.kind,
        scent.reason,
        scent.picker_id,
        scent.wave,
        lit,
      ],
    );
    return mapScent(r.rows[0]);
  }

  async similarScents(warehouseId: string, embedding: number[], limit = 5): Promise<Scent[]> {
    const lit = embeddingLiteral(embedding);
    const r = await getPool().query(
      `SELECT * FROM scents
       WHERE warehouse_id = $1
       ORDER BY embedding <-> $2::vector
       LIMIT $3`,
      [warehouseId, lit, limit],
    );
    return r.rows.map(mapScent);
  }

  async hasScentFrom(
    warehouseId: string,
    cell: { x: number; y: number },
    kind: Scent["kind"],
    pickerId: string,
  ): Promise<boolean> {
    const r = await getPool().query(
      `SELECT 1 FROM scents
       WHERE warehouse_id = $1 AND cell_x = $2 AND cell_y = $3 AND kind = $4 AND picker_id = $5
       LIMIT 1`,
      [warehouseId, cell.x, cell.y, kind, pickerId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async recordEvent(event: Omit<FloorEvent, "id" | "at"> & { at?: string }): Promise<FloorEvent> {
    const r = await getPool().query(
      `INSERT INTO floor_events
        (warehouse_id, picker_id, event_type, cell_x, cell_y, package_id, sql_text, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       RETURNING *`,
      [
        event.warehouse_id,
        event.picker_id,
        event.event_type,
        event.cell_x,
        event.cell_y,
        event.package_id,
        event.sql_text,
        JSON.stringify(event.payload ?? {}),
      ],
    );
    return mapEvent(r.rows[0]);
  }

  async reset(warehouseId: string): Promise<void> {
    await this.ensureRuntimeTables();
    await withSerializable(async (c) => {
      await c.query("DELETE FROM picker_loops WHERE warehouse_id = $1", [warehouseId]);
      await c.query("DELETE FROM floor_runtime WHERE warehouse_id = $1", [warehouseId]);
      await c.query("DELETE FROM floor_events WHERE warehouse_id = $1", [warehouseId]);
      await c.query("DELETE FROM scents WHERE warehouse_id = $1", [warehouseId]);
      await c.query("DELETE FROM packages WHERE warehouse_id = $1", [warehouseId]);
      await c.query("DELETE FROM cells WHERE warehouse_id = $1", [warehouseId]);
    });
    await this.ensureSeeded(warehouseId);
  }
}

export async function applySchemaFile(): Promise<void> {
  const sql = fs.readFileSync(path.join(process.cwd(), "sql/schema.sql"), "utf8");
  await getPool().query(sql);
}
