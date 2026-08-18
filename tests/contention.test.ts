import { describe, expect, it } from "vitest";
import { CONTESTED_SKU, DOCK_DOORS, TEST_WAREHOUSE, pickerId } from "@/lib/config";
import { MemoryStore } from "@/lib/memory-store";
import { pickerTick } from "@/lib/picker";

/**
 * The whole product claims that coordination is a write conflict. These tests
 * exist because it is possible to build this simulation so that conflicts never
 * happen at all, in which case every claim the UI makes is unfalsifiable.
 */
describe("contention actually happens", () => {
  it("two pickers reaching for one package produce a winner and a dead-end scent", async () => {
    const store = new MemoryStore();
    await store.ensureSeeded(TEST_WAREHOUSE);
    const pkgs = await store.getPackages(TEST_WAREHOUSE);
    const target = pkgs.find((p) => p.sku === CONTESTED_SKU)!;

    // Placed either side of the shelf. Neither is told to want it.
    await store.claimCell(TEST_WAREHOUSE, target.x - 1, target.y, "p1");
    await store.claimCell(TEST_WAREHOUSE, target.x + 1, target.y, "p2");

    const results = await Promise.all([
      pickerTick(store, "p1", TEST_WAREHOUSE),
      pickerTick(store, "p2", TEST_WAREHOUSE),
    ]);
    const actions = results.map((r) => r.action).sort();

    expect(actions).toEqual(["claimed", "dead_end"]);

    const snap = await store.snapshot(TEST_WAREHOUSE, ["p1", "p2"]);
    const deadEnds = snap.scents.filter((s) => s.kind === "dead_end");
    expect(deadEnds).toHaveLength(1);
    expect(deadEnds[0].embedding).toHaveLength(384);

    // The loser recorded who beat it, so the UI can name the winner.
    const lost = snap.events.find((e) => e.event_type === "dead_end");
    expect(lost?.payload?.rows).toBe(0);
    expect(lost?.payload?.winner).toBeTruthy();

    // Exactly one picker holds the package.
    const after = await store.getPackages(TEST_WAREHOUSE);
    const claimedBy = after.find((p) => p.id === target.id)?.claimed_by;
    expect(["p1", "p2"]).toContain(claimedBy);
  });

  it("a normal run records failed claims rather than gliding through in parallel lanes", async () => {
    const store = new MemoryStore();
    await store.ensureSeeded(TEST_WAREHOUSE);
    const ids = Array.from({ length: 8 }, (_, i) => pickerId(i + 1));

    for (let t = 0; t < 120; t++) {
      await Promise.all(ids.map((id) => pickerTick(store, id, TEST_WAREHOUSE)));
    }

    const counts = await store.counts(TEST_WAREHOUSE);
    expect(counts.events).toBeGreaterThan(0);
    // Funnelling every package through three dock doors has to make pickers
    // collide somewhere, otherwise the demo has nothing to demonstrate.
    expect(counts.deadEnds + counts.jams).toBeGreaterThan(0);
    expect(counts.messages).toBe(0);
  });

  /**
   * Contention must not become gridlock. An earlier version let dead-end scents
   * outweigh the distance gradient, so carriers ping-ponged between two cells and
   * the floor never cleared — the demo froze halfway with packages in hand.
   */
  it("every package still reaches the dock once contention is in play", async () => {
    const store = new MemoryStore();
    await store.ensureSeeded(TEST_WAREHOUSE);
    const ids = Array.from({ length: 8 }, (_, i) => pickerId(i + 1));

    let ticks = 0;
    let delivered = 0;
    const total = (await store.getPackages(TEST_WAREHOUSE)).length;

    while (ticks < 600 && delivered < total) {
      await Promise.all(ids.map((id) => pickerTick(store, id, TEST_WAREHOUSE)));
      ticks += 1;
      delivered = (await store.getPackages(TEST_WAREHOUSE)).filter(
        (p) => p.status === "delivered",
      ).length;
    }

    expect(delivered).toBe(total);

    // And it happened despite real contention, not by avoiding it.
    const counts = await store.counts(TEST_WAREHOUSE);
    expect(counts.deadEnds + counts.jams).toBeGreaterThan(0);
  });

  it("an idle picker does not squat on a dock door", async () => {
    const store = new MemoryStore();
    await store.ensureSeeded(TEST_WAREHOUSE);

    // Nothing left to carry, and this picker is sitting on the delivery column.
    for (const p of await store.getPackages(TEST_WAREHOUSE)) {
      await store.claimPackage(TEST_WAREHOUSE, p.id, "p9");
      await store.deliverPackage(TEST_WAREHOUSE, p.id, "p9");
    }
    await store.claimCell(TEST_WAREHOUSE, 0, DOCK_DOORS[0], "p1");

    for (let t = 0; t < 12; t++) await pickerTick(store, "p1", TEST_WAREHOUSE);

    const pos = await store.positionOf(TEST_WAREHOUSE, "p1");
    expect(pos!.x).toBeGreaterThan(0);
  });

  it("recall can be switched off without stopping the swarm", async () => {
    const { setRecallEnabled, recallEnabled } = await import("@/lib/recall");
    setRecallEnabled(false);
    try {
      expect(recallEnabled()).toBe(false);
      const store = new MemoryStore();
      await store.ensureSeeded(TEST_WAREHOUSE);
      const r = await pickerTick(store, "p1", TEST_WAREHOUSE);
      expect(r.action).not.toBe("");
      const snap = await store.snapshot(TEST_WAREHOUSE, ["p1"]);
      expect(snap.recallEnabled).toBe(false);
    } finally {
      setRecallEnabled(true);
    }
  });
});
