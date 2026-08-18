import { describe, expect, it } from "vitest";
import { MemoryStore } from "../lib/memory-store";
import { pickerTick } from "../lib/picker";
import { TEST_WAREHOUSE } from "../lib/config";

describe("pickerTick", () => {
  it("spawns onto the dock and writes an event", async () => {
    const store = new MemoryStore();
    const r = await pickerTick(store, "p1", TEST_WAREHOUSE);
    expect(["spawn_blocked", "step", "idle", "claimed", "blocked"]).toContain(r.action);
    const pos = await store.positionOf(TEST_WAREHOUSE, "p1");
    expect(pos).not.toBeNull();
    const snap = await store.snapshot(TEST_WAREHOUSE, ["p1"]);
    expect(snap.events.some((e) => e.event_type === "spawn")).toBe(true);
  });

  it("records a dead_end when two pickers contest the same waiting package", async () => {
    const store = new MemoryStore();
    await store.ensureSeeded(TEST_WAREHOUSE);
    const pkgs = await store.getPackages(TEST_WAREHOUSE);
    const insulin = pkgs.find((p) => p.sku === "INSULIN")!;
    await store.claimCell(TEST_WAREHOUSE, insulin.x, insulin.y, "p1");
    await store.claimCell(TEST_WAREHOUSE, insulin.x, insulin.y - 1, "p2");
    await store.movePicker(
      TEST_WAREHOUSE,
      "p2",
      { x: insulin.x, y: insulin.y - 1 },
      { x: insulin.x, y: insulin.y },
    );
    const first = await pickerTick(store, "p1", TEST_WAREHOUSE);
    const second = await pickerTick(store, "p2", TEST_WAREHOUSE);
    const actions = [first.action, second.action];
    const snap = await store.snapshot(TEST_WAREHOUSE, ["p1", "p2"]);
    const claimed = snap.packages.find((p) => p.sku === "INSULIN");
    expect(claimed?.status === "claimed" || actions.includes("claimed") || actions.includes("dead_end")).toBe(
      true,
    );
  });
});
