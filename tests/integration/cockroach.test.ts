import { describe, expect, it } from "vitest";
import { CockroachStore } from "../../lib/pg-store";
import { TEST_WAREHOUSE } from "../../lib/config";
import { embedText } from "../../lib/embed";
import { pickerTick } from "../../lib/picker";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Cockroach integration", () => {
  it("serializable cell claim: one winner", async () => {
    const store = new CockroachStore();
    await store.reset(TEST_WAREHOUSE);
    const [a, b] = await Promise.all([
      store.claimCell(TEST_WAREHOUSE, 5, 5, "p1"),
      store.claimCell(TEST_WAREHOUSE, 5, 5, "p2"),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("package claim is atomic — no double book", async () => {
    const store = new CockroachStore();
    await store.reset(TEST_WAREHOUSE);
    const pkgs = await store.getPackages(TEST_WAREHOUSE);
    const insulin = pkgs.find((p) => p.sku === "INSULIN")!;
    const [w1, w2] = await Promise.all([
      store.claimPackage(TEST_WAREHOUSE, insulin.id, "p1"),
      store.claimPackage(TEST_WAREHOUSE, insulin.id, "p2"),
    ]);
    expect([w1, w2].filter(Boolean)).toHaveLength(1);
  });

  it("vector query stays inside warehouse prefix", async () => {
    const store = new CockroachStore();
    await store.reset(TEST_WAREHOUSE);
    await store.reset("floor-b");
    await store.insertScent({
      warehouse_id: "floor-b",
      cell_x: 9,
      cell_y: 4,
      kind: "dead_end",
      reason: "poisoned retrieval from floor-b insulin jam",
      picker_id: "px",
      wave: 1,
      embedding: embedText("poisoned retrieval from floor-b insulin jam"),
    });
    const q = embedText("poisoned retrieval insulin jam");
    const hits = await store.similarScents(TEST_WAREHOUSE, q, 5);
    expect(hits.every((h) => h.warehouse_id === TEST_WAREHOUSE)).toBe(true);
  });

  it("kill/resume: reservation survives; picker continues from SQL", async () => {
    const store = new CockroachStore();
    await store.reset(TEST_WAREHOUSE);
    await pickerTick(store, "p4", TEST_WAREHOUSE);
    const before = await store.positionOf(TEST_WAREHOUSE, "p4");
    expect(before).not.toBeNull();
    await pickerTick(store, "p4", TEST_WAREHOUSE);
    const after = await store.positionOf(TEST_WAREHOUSE, "p4");
    expect(after?.reserved_by).toBe("p4");
  });
});
