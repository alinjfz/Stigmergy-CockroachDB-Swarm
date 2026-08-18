import { DEFAULT_SPAWN, DEFAULT_WAREHOUSE, MAX_PICKERS, pickerId, tickMs } from "./config";
import { getStore } from "./get-store";
import { pickerTick } from "./picker";

type Handle = {
  id: string;
  timer: ReturnType<typeof setInterval> | null;
};

const g = globalThis as unknown as {
  __stigmergyWorkers?: Map<string, Handle>;
};

function table(): Map<string, Handle> {
  if (!g.__stigmergyWorkers) g.__stigmergyWorkers = new Map();
  return g.__stigmergyWorkers;
}

export function livePickerIds(): string[] {
  return [...table().keys()];
}

export function spawnPickers(count = DEFAULT_SPAWN, warehouseId = DEFAULT_WAREHOUSE): string[] {
  const n = Math.min(MAX_PICKERS, Math.max(1, count));
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const id = pickerId(i);
    if (table().has(id)) continue;
    startLoop(id, warehouseId);
    ids.push(id);
  }
  return ids;
}

/** Picker slots not currently running, so a new experiment can borrow some. */
export function freePickerIds(count: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= MAX_PICKERS && out.length < count; i++) {
    const id = pickerId(i);
    if (!table().has(id)) out.push(id);
  }
  return out;
}

/**
 * Start one picker that has already been given a position. Used by the conflict
 * experiment: placing two pickers next to the same shelf is not the same as
 * telling either of them what to do, so the swarm stays unsupervised.
 */
export function startPicker(id: string, warehouseId = DEFAULT_WAREHOUSE): boolean {
  if (table().has(id)) return false;
  startLoop(id, warehouseId);
  return true;
}

function startLoop(id: string, warehouseId: string): void {
  const tick = () => {
    void pickerTick(getStore(), id, warehouseId).catch((err: unknown) => {
      console.error("picker tick failed", id, err);
    });
  };
  tick();
  const timer = setInterval(tick, tickMs());
  table().set(id, { id, timer });
}

export function killPickers(ids: string[]): string[] {
  const killed: string[] = [];
  for (const id of ids) {
    const h = table().get(id);
    if (!h) continue;
    if (h.timer) clearInterval(h.timer);
    table().delete(id);
    killed.push(id);
  }
  return killed;
}

export function killHalf(): string[] {
  const ids = livePickerIds();
  const slice = ids.slice(0, Math.ceil(ids.length / 2));
  return killPickers(slice);
}

export function killAll(): string[] {
  return killPickers(livePickerIds());
}

/** Respawn the same ids — they re-read Cockroach, not RAM. */
export function respawnSame(ids: string[], warehouseId = DEFAULT_WAREHOUSE): string[] {
  const started: string[] = [];
  for (const id of ids) {
    if (table().has(id)) continue;
    startLoop(id, warehouseId);
    started.push(id);
  }
  return started;
}
