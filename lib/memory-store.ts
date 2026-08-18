import { GRID_HEIGHT, GRID_WIDTH, SEED_PACKAGES } from "./config";
import { cosine } from "./embed";
import type { Store } from "./store";
import type { Cell, ClaimResult, FloorEvent, FloorSnapshot, Package, Scent } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

export class MemoryStore implements Store {
  kind = "memory" as const;
  private cells = new Map<string, Cell>();
  private packages = new Map<string, Package>();
  private scents: Scent[] = [];
  private events: FloorEvent[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  private lock<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private key(wh: string, x: number, y: number): string {
    return `${wh}:${x},${y}`;
  }

  async ensureSeeded(warehouseId: string): Promise<void> {
    return this.lock(() => {
      const existing = [...this.cells.values()].some((c) => c.warehouse_id === warehouseId);
      if (existing) return;
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          this.cells.set(this.key(warehouseId, x, y), {
            warehouse_id: warehouseId,
            x,
            y,
            package_id: null,
            reserved_by: null,
            reserved_at: null,
          });
        }
      }
      for (const p of SEED_PACKAGES) {
        const id = crypto.randomUUID();
        this.packages.set(id, {
          id,
          warehouse_id: warehouseId,
          sku: p.sku,
          label: p.label,
          x: p.x,
          y: p.y,
          dest_x: p.dest_x,
          dest_y: p.dest_y,
          status: "waiting",
          claimed_by: null,
          claimed_at: null,
        });
        const cell = this.cells.get(this.key(warehouseId, p.x, p.y));
        if (cell) cell.package_id = id;
      }
    });
  }

  async snapshot(warehouseId: string, livePickers: string[]): Promise<FloorSnapshot> {
    await this.ensureSeeded(warehouseId);
    return {
      warehouseId,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      cells: [...this.cells.values()].filter((c) => c.warehouse_id === warehouseId),
      packages: [...this.packages.values()].filter((p) => p.warehouse_id === warehouseId),
      scents: this.scents.filter((s) => s.warehouse_id === warehouseId),
      events: this.events.filter((e) => e.warehouse_id === warehouseId).slice(-80).reverse(),
      livePickers,
      wave: 1,
      store: "memory",
    };
  }

  async getCells(warehouseId: string): Promise<Cell[]> {
    await this.ensureSeeded(warehouseId);
    return [...this.cells.values()].filter((c) => c.warehouse_id === warehouseId);
  }

  async getPackages(warehouseId: string): Promise<Package[]> {
    await this.ensureSeeded(warehouseId);
    return [...this.packages.values()].filter((p) => p.warehouse_id === warehouseId);
  }

  async positionOf(warehouseId: string, pickerId: string): Promise<Cell | null> {
    return (
      [...this.cells.values()].find(
        (c) => c.warehouse_id === warehouseId && c.reserved_by === pickerId,
      ) ?? null
    );
  }

  async heldBy(warehouseId: string, pickerId: string): Promise<Package | null> {
    return (
      [...this.packages.values()].find(
        (p) => p.warehouse_id === warehouseId && p.claimed_by === pickerId && p.status === "claimed",
      ) ?? null
    );
  }

  async claimCell(warehouseId: string, x: number, y: number, pickerId: string): Promise<ClaimResult> {
    return this.lock(() => {
      const cell = this.cells.get(this.key(warehouseId, x, y));
      if (!cell) return { ok: false as const, reason: "missing" as const };
      if (cell.reserved_by && cell.reserved_by !== pickerId) {
        return { ok: false as const, reason: "occupied" as const };
      }
      cell.reserved_by = pickerId;
      cell.reserved_at = nowIso();
      return { ok: true as const, cell: { ...cell } };
    });
  }

  async releaseCell(warehouseId: string, pickerId: string): Promise<void> {
    return this.lock(() => {
      for (const cell of this.cells.values()) {
        if (cell.warehouse_id === warehouseId && cell.reserved_by === pickerId) {
          cell.reserved_by = null;
          cell.reserved_at = null;
        }
      }
    });
  }

  async movePicker(
    warehouseId: string,
    pickerId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<ClaimResult> {
    return this.lock(() => {
      const dest = this.cells.get(this.key(warehouseId, to.x, to.y));
      if (!dest) return { ok: false as const, reason: "missing" as const };
      if (dest.reserved_by && dest.reserved_by !== pickerId) {
        return { ok: false as const, reason: "occupied" as const };
      }
      const src = this.cells.get(this.key(warehouseId, from.x, from.y));
      if (src && src.reserved_by === pickerId) {
        src.reserved_by = null;
        src.reserved_at = null;
      }
      dest.reserved_by = pickerId;
      dest.reserved_at = nowIso();
      return { ok: true as const, cell: { ...dest } };
    });
  }

  async claimPackage(warehouseId: string, packageId: string, pickerId: string): Promise<boolean> {
    return this.lock(() => {
      const pkg = this.packages.get(packageId);
      if (!pkg || pkg.warehouse_id !== warehouseId) return false;
      if (pkg.status !== "waiting" || pkg.claimed_by) return false;
      pkg.status = "claimed";
      pkg.claimed_by = pickerId;
      pkg.claimed_at = nowIso();
      return true;
    });
  }

  async deliverPackage(warehouseId: string, packageId: string, pickerId: string): Promise<void> {
    return this.lock(() => {
      const pkg = this.packages.get(packageId);
      if (!pkg || pkg.claimed_by !== pickerId) return;
      pkg.status = "delivered";
      const origin = this.cells.get(this.key(warehouseId, pkg.x, pkg.y));
      if (origin && origin.package_id === pkg.id) origin.package_id = null;
    });
  }

  async insertScent(scent: Omit<Scent, "id" | "created_at">): Promise<Scent> {
    const row: Scent = {
      ...scent,
      id: crypto.randomUUID(),
      created_at: nowIso(),
    };
    this.scents.push(row);
    return row;
  }

  async similarScents(warehouseId: string, embedding: number[], limit = 5): Promise<Scent[]> {
    return this.scents
      .filter((s) => s.warehouse_id === warehouseId)
      .map((s) => ({ s, sim: cosine(embedding, s.embedding) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit)
      .map((x) => x.s);
  }

  async recordEvent(event: Omit<FloorEvent, "id" | "at"> & { at?: string }): Promise<FloorEvent> {
    const row: FloorEvent = {
      ...event,
      id: crypto.randomUUID(),
      at: event.at ?? nowIso(),
    };
    this.events.push(row);
    return row;
  }

  async reset(warehouseId: string): Promise<void> {
    return this.lock(() => {
      for (const [k, c] of this.cells) {
        if (c.warehouse_id === warehouseId) this.cells.delete(k);
      }
      for (const [k, p] of this.packages) {
        if (p.warehouse_id === warehouseId) this.packages.delete(k);
      }
      this.scents = this.scents.filter((s) => s.warehouse_id !== warehouseId);
      this.events = this.events.filter((e) => e.warehouse_id !== warehouseId);
    });
  }
}
