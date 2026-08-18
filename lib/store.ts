import type { Cell, ClaimResult, FloorEvent, FloorSnapshot, Package, Scent } from "./types";

export type Store = {
  kind: "cockroach" | "memory";
  ensureSeeded(warehouseId: string): Promise<void>;
  snapshot(warehouseId: string, livePickers: string[]): Promise<FloorSnapshot>;
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
  claimPackage(warehouseId: string, packageId: string, pickerId: string): Promise<boolean>;
  deliverPackage(warehouseId: string, packageId: string, pickerId: string): Promise<void>;
  insertScent(scent: Omit<Scent, "id" | "created_at">): Promise<Scent>;
  similarScents(
    warehouseId: string,
    embedding: number[],
    limit?: number,
  ): Promise<Scent[]>;
  recordEvent(event: Omit<FloorEvent, "id" | "at"> & { at?: string }): Promise<FloorEvent>;
  reset(warehouseId: string): Promise<void>;
  heldBy(warehouseId: string, pickerId: string): Promise<Package | null>;
};
