import { CockroachStore } from "./pg-store";
import { MemoryStore } from "./memory-store";
import type { Store } from "./store";

const g = globalThis as unknown as { __stigmergyStore?: Store };

export function getStore(): Store {
  if (g.__stigmergyStore) return g.__stigmergyStore;

  const mode = process.env.STIGMERGY_STORE;
  if (mode === "memory" || !process.env.DATABASE_URL) {
    g.__stigmergyStore = new MemoryStore();
    return g.__stigmergyStore;
  }
  g.__stigmergyStore = new CockroachStore();
  return g.__stigmergyStore;
}

export function resetStoreSingleton(): void {
  g.__stigmergyStore = undefined;
}
