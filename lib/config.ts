export const GRID_WIDTH = 12;
export const GRID_HEIGHT = 10;
export const DEFAULT_WAREHOUSE = "default";
export const TEST_WAREHOUSE = "test";
export const FLOOR_B = "floor-b";
export const EMBEDDING_DIMS = 384;
export const MAX_PICKERS = 12;
export const DEFAULT_SPAWN = 8;

export const SEED_PACKAGES = [
  { sku: "INSULIN", label: "INSULIN · last unit", x: 9, y: 4, dest_x: 0, dest_y: 4 },
  { sku: "VIALS", label: "VIALS · glass", x: 10, y: 1, dest_x: 0, dest_y: 1 },
  { sku: "GAUZE", label: "GAUZE · bulk", x: 8, y: 7, dest_x: 0, dest_y: 7 },
  { sku: "SALINE", label: "SALINE · 1L", x: 11, y: 5, dest_x: 0, dest_y: 5 },
  { sku: "SPLINTS", label: "SPLINTS", x: 7, y: 2, dest_x: 0, dest_y: 2 },
  { sku: "AED-PADS", label: "AED-PADS", x: 10, y: 8, dest_x: 0, dest_y: 8 },
  { sku: "EPIPEN", label: "EPIPEN · cold", x: 6, y: 6, dest_x: 0, dest_y: 6 },
  { sku: "COLD-CHAIN", label: "COLD-CHAIN", x: 11, y: 3, dest_x: 0, dest_y: 3 },
] as const;

export function pickerId(n: number): string {
  return `p${n}`;
}

export function tickMs(): number {
  const n = Number(process.env.PICKER_TICK_MS ?? 650);
  return Number.isFinite(n) && n >= 120 ? n : 650;
}
