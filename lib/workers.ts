import { DEFAULT_SPAWN, DEFAULT_WAREHOUSE, MAX_PICKERS, pickerId, tickMs } from "./config";
import { getStore } from "./get-store";
import { pickerTick } from "./picker";
import { setRecallEnabled } from "./recall";

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

function serverless(): boolean {
  return process.env.VERCEL === "1";
}

export function livePickerIds(): string[] {
  return [...table().keys()];
}

export async function runningPickerIds(warehouseId = DEFAULT_WAREHOUSE): Promise<string[]> {
  if (serverless()) return getStore().listPickerLoops(warehouseId);
  return livePickerIds();
}

export async function spawnPickers(
  count = DEFAULT_SPAWN,
  warehouseId = DEFAULT_WAREHOUSE,
): Promise<string[]> {
  const n = Math.min(MAX_PICKERS, Math.max(1, count));
  const live = new Set(await runningPickerIds(warehouseId));
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const id = pickerId(i);
    if (live.has(id) || table().has(id)) continue;
    if (serverless()) {
      table().set(id, { id, timer: null });
    } else {
      startLoop(id, warehouseId);
    }
    ids.push(id);
  }
  if (ids.length && serverless()) await getStore().addPickerLoops(warehouseId, ids);
  return ids;
}

/** Picker slots not currently running, so a new experiment can borrow some. */
export async function freePickerIds(
  count: number,
  warehouseId = DEFAULT_WAREHOUSE,
): Promise<string[]> {
  const live = new Set(await runningPickerIds(warehouseId));
  const out: string[] = [];
  for (let i = 1; i <= MAX_PICKERS && out.length < count; i++) {
    const id = pickerId(i);
    if (!live.has(id)) out.push(id);
  }
  return out;
}

/**
 * Start one picker that has already been given a position. Used by the conflict
 * experiment: placing two pickers next to the same shelf is not the same as
 * telling either of them what to do, so the swarm stays unsupervised.
 */
export async function startPicker(id: string, warehouseId = DEFAULT_WAREHOUSE): Promise<boolean> {
  const live = new Set(await runningPickerIds(warehouseId));
  if (live.has(id)) return false;
  if (serverless()) {
    table().set(id, { id, timer: null });
    await getStore().addPickerLoops(warehouseId, [id]);
    return true;
  }
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

export async function killPickers(
  ids: string[],
  warehouseId = DEFAULT_WAREHOUSE,
): Promise<string[]> {
  const killed: string[] = [];
  for (const id of ids) {
    const h = table().get(id);
    if (h?.timer) clearInterval(h.timer);
    if (h) table().delete(id);
    killed.push(id);
  }
  if (serverless() && ids.length) await getStore().removePickerLoops(warehouseId, ids);
  return killed;
}

export async function killHalf(warehouseId = DEFAULT_WAREHOUSE): Promise<string[]> {
  const ids = await runningPickerIds(warehouseId);
  const slice = ids.slice(0, Math.ceil(ids.length / 2));
  return killPickers(slice, warehouseId);
}

export async function killAll(warehouseId = DEFAULT_WAREHOUSE): Promise<string[]> {
  return killPickers(await runningPickerIds(warehouseId), warehouseId);
}

/** Respawn the same ids — they re-read Cockroach, not RAM. */
export async function respawnSame(
  ids: string[],
  warehouseId = DEFAULT_WAREHOUSE,
): Promise<string[]> {
  const started: string[] = [];
  const live = new Set(await runningPickerIds(warehouseId));
  for (const id of ids) {
    if (live.has(id)) continue;
    if (serverless()) {
      table().set(id, { id, timer: null });
    } else {
      startLoop(id, warehouseId);
    }
    started.push(id);
  }
  if (started.length && serverless()) await getStore().addPickerLoops(warehouseId, started);
  return started;
}

/** On Vercel, move the swarm once per floor poll because setInterval dies with the function. */
export async function tickRunningPickers(warehouseId = DEFAULT_WAREHOUSE): Promise<string[]> {
  const store = getStore();
  if (serverless()) {
    setRecallEnabled(await store.getRecallFlag(warehouseId));
  }
  const ids = await runningPickerIds(warehouseId);
  if (serverless() && ids.length) {
    await Promise.all(
      ids.map((id) =>
        pickerTick(store, id, warehouseId).catch((err: unknown) => {
          console.error("picker tick failed", id, err);
        }),
      ),
    );
  }
  return ids;
}
