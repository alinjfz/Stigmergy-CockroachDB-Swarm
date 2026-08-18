import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetStoreSingleton } from "../lib/get-store";
import { killAll, killHalf, livePickerIds, respawnSame, spawnPickers } from "../lib/workers";

describe("workers", () => {
  beforeEach(async () => {
    process.env.STIGMERGY_STORE = "memory";
    delete process.env.DATABASE_URL;
    resetStoreSingleton();
    await killAll();
  });

  afterEach(async () => {
    await killAll();
  });

  it("spawn, kill half, respawn same ids — RAM gone, ids persist", async () => {
    await spawnPickers(8, "test");
    expect(livePickerIds()).toHaveLength(8);
    const killed = await killHalf();
    expect(killed.length).toBe(4);
    expect(livePickerIds()).toHaveLength(4);
    const back = await respawnSame(killed, "test");
    expect(back).toEqual(killed);
    expect(livePickerIds()).toHaveLength(8);
  });

  it("killAll clears the in-process table", async () => {
    await spawnPickers(3, "test");
    await killAll();
    expect(livePickerIds()).toEqual([]);
  });
});
