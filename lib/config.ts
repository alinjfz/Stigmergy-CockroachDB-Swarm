export const GRID_WIDTH = 12;
export const GRID_HEIGHT = 10;
export const DEFAULT_WAREHOUSE = "default";
export const TEST_WAREHOUSE = "test";
export const FLOOR_B = "floor-b";
export const EMBEDDING_DIMS = 384;
export const MAX_PICKERS = 12;
export const DEFAULT_SPAWN = 8;

/**
 * The SKU this floor seeds as a single last unit. One box, many pickers.
 */
export const CONTESTED_SKU = "SPARE";
export const CONTESTED_LABEL = "SPARE · last unit";
export const CONTESTED_CELL = { x: 9, y: 4 } as const;

/**
 * A real dock has a handful of doors, not one door per aisle. Funnelling every
 * package through three rows is what makes pickers cross each other's paths, so
 * cell contention is something the swarm actually has to resolve rather than
 * something the seed data quietly designs away.
 */
export const DOCK_DOORS = [3, 4, 5] as const;

export const SEED_PACKAGES = [
  { sku: CONTESTED_SKU, label: CONTESTED_LABEL, x: CONTESTED_CELL.x, y: CONTESTED_CELL.y, dest_x: 0, dest_y: 4 },
  { sku: "CABLE", label: "CABLE", x: 10, y: 1, dest_x: 0, dest_y: 3 },
  { sku: "BATTERY", label: "BATTERY", x: 8, y: 7, dest_x: 0, dest_y: 5 },
  { sku: "BOLTS", label: "BOLTS", x: 11, y: 5, dest_x: 0, dest_y: 5 },
  { sku: "TAPE", label: "TAPE", x: 7, y: 2, dest_x: 0, dest_y: 3 },
  { sku: "FILTER", label: "FILTER", x: 10, y: 8, dest_x: 0, dest_y: 5 },
  { sku: "SEAL", label: "SEAL", x: 6, y: 6, dest_x: 0, dest_y: 4 },
  { sku: "PALLET", label: "PALLET", x: 11, y: 3, dest_x: 0, dest_y: 3 },
] as const;

export function pickerId(n: number): string {
  return `p${n}`;
}

export function tickMs(): number {
  const n = Number(process.env.PICKER_TICK_MS ?? 650);
  return Number.isFinite(n) && n >= 120 ? n : 650;
}
