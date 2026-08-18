import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetStoreSingleton } from "../lib/get-store";
import { killAll, killHalf, livePickerIds, respawnSame, spawnPickers } from "../lib/workers";

describe("workers", () => {
  beforeEach(() => {
    process.env.STIGMERGY_STORE = "memory";
    delete process.env.DATABASE_URL;
    resetStoreSingleton();
    killAll();
  });

  afterEach(() => {
    killAll();
  });

  it("spawn, kill half, respawn same ids — RAM gone, ids persist", () => {
    spawnPickers(8, "test");
    expect(livePickerIds()).toHaveLength(8);
    const killed = killHalf();
    expect(killed.length).toBe(4);
    expect(livePickerIds()).toHaveLength(4);
    const back = respawnSame(killed, "test");
    expect(back).toEqual(killed);
    expect(livePickerIds()).toHaveLength(8);
  });

  it("killAll clears the in-process table", () => {
    spawnPickers(3, "test");
    killAll();
    expect(livePickerIds()).toEqual([]);
  });
});
