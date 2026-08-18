import { describe, expect, it } from "vitest";
import { MemoryStore } from "../lib/memory-store";
import { pickerTick } from "../lib/picker";
import { CONTESTED_SKU, TEST_WAREHOUSE } from "../lib/config";

describe("MemoryStore claims", () => {
  it("lets only one picker win a concurrent cell claim", async () => {
    const store = new MemoryStore();
    await store.ensureSeeded(TEST_WAREHOUSE);
    const [a, b] = await Promise.all([
      store.claimCell(TEST_WAREHOUSE, 4, 4, "p1"),
      store.claimCell(TEST_WAREHOUSE, 4, 4, "p2"),
    ]);
    const wins = [a, b].filter((r) => r.ok);
    const losses = [a, b].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    const pos1 = await store.positionOf(TEST_WAREHOUSE, "p1");
    const pos2 = await store.positionOf(TEST_WAREHOUSE, "p2");
    const holders = [pos1, pos2].filter(Boolean);
    expect(holders).toHaveLength(1);
  });

  it("does not create a phantom package claim", async () => {
    const store = new MemoryStore();
    await store.ensureSeeded(TEST_WAREHOUSE);
    const pkgs = await store.getPackages(TEST_WAREHOUSE);
    const spare = pkgs.find((p) => p.sku === CONTESTED_SKU);
    expect(spare).toBeTruthy();
    const [w1, w2] = await Promise.all([
      store.claimPackage(TEST_WAREHOUSE, spare!.id, "p1"),
      store.claimPackage(TEST_WAREHOUSE, spare!.id, "p2"),
    ]);
    expect([w1, w2].filter(Boolean)).toHaveLength(1);
    const again = await store.getPackages(TEST_WAREHOUSE);
    const row = again.find((p) => p.id === spare!.id)!;
    expect(row.status).toBe("claimed");
    expect(row.claimed_by === "p1" || row.claimed_by === "p2").toBe(true);
  });

  it("prefix-isolates scent recall by warehouse", async () => {
    const store = new MemoryStore();
    await store.ensureSeeded("default");
    await store.ensureSeeded("floor-b");
    const { embedText } = await import("../lib/embed");
    const q = embedText("jammed spare aisle");
    await store.insertScent({
      warehouse_id: "floor-b",
      cell_x: 9,
      cell_y: 4,
      kind: "dead_end",
      reason: "jammed spare aisle floor-b only",
      picker_id: "px",
      wave: 1,
      embedding: embedText("jammed spare aisle floor-b only"),
    });
    await store.insertScent({
      warehouse_id: "default",
      cell_x: 1,
      cell_y: 1,
      kind: "trail",
      reason: "unrelated trail default",
      picker_id: "p1",
      wave: 1,
      embedding: embedText("unrelated trail default"),
    });
    const hits = await store.similarScents("default", q, 3);
    expect(hits.every((h) => h.warehouse_id === "default")).toBe(true);
    expect(hits.some((h) => h.warehouse_id === "floor-b")).toBe(false);
  });

  it("keeps reservations when the worker process is gone (kill/resume)", async () => {
    const store = new MemoryStore();
    await store.ensureSeeded(TEST_WAREHOUSE);
    await store.claimCell(TEST_WAREHOUSE, 0, 1, "p3");
    const before = await store.positionOf(TEST_WAREHOUSE, "p3");
    expect(before?.x).toBe(0);
    const afterKill = await store.positionOf(TEST_WAREHOUSE, "p3");
    expect(afterKill?.reserved_by).toBe("p3");
    await pickerTick(store, "p3", TEST_WAREHOUSE);
    const resumed = await store.positionOf(TEST_WAREHOUSE, "p3");
    expect(resumed?.reserved_by).toBe("p3");
  });
});
