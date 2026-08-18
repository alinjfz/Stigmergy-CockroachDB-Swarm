import type {
  Cell,
  ClaimResult,
  FloorCounts,
  FloorEvent,
  FloorSnapshot,
  Package,
  Scent,
} from "./types";

export type Store = {
  kind: "cockroach" | "memory";
  ensureSeeded(warehouseId: string): Promise<void>;
  snapshot(warehouseId: string, livePickers: string[]): Promise<FloorSnapshot>;
  counts(warehouseId: string): Promise<FloorCounts>;
  getCells(warehouseId: string): Promise<Cell[]>;
  getPackages(warehouseId: string): Promise<Package[]>;
  positionOf(warehouseId: string, pickerId: string): Promise<Cell | null>;
  claimCell(warehouseId: string, x: number, y: number, pickerId: string): Promise<ClaimResult>;
  releaseCell(warehouseId: string, pickerId: string): Promise<void>;
  movePicker(
    warehouseId: string,
    pickerId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<ClaimResult>;
  /**
   * Put one more package on a shelf. Used to restock a single contested unit so
   * the conflict experiment stays repeatable after the floor has been cleared.
   */
  addPackage(
    warehouseId: string,
    spec: { sku: string; label: string; x: number; y: number; dest_x: number; dest_y: number },
  ): Promise<Package>;
  claimPackage(warehouseId: string, packageId: string, pickerId: string): Promise<boolean>;
  deliverPackage(warehouseId: string, packageId: string, pickerId: string): Promise<void>;
  insertScent(scent: Omit<Scent, "id" | "created_at">): Promise<Scent>;
  similarScents(
    warehouseId: string,
    embedding: number[],
    limit?: number,
  ): Promise<Scent[]>;
  /**
   * Has this picker already recorded this kind of failure at this cell? Read from
   * the table rather than kept in the worker, so a picker that is stopped and
   * restarted does not forget what it already learned.
   */
  hasScentFrom(
    warehouseId: string,
    cell: { x: number; y: number },
    kind: Scent["kind"],
    pickerId: string,
  ): Promise<boolean>;
  recordEvent(event: Omit<FloorEvent, "id" | "at"> & { at?: string }): Promise<FloorEvent>;
  reset(warehouseId: string): Promise<void>;
  heldBy(warehouseId: string, pickerId: string): Promise<Package | null>;
};
