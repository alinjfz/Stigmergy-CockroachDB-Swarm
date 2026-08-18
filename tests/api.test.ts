import { afterEach, describe, expect, it } from "vitest";
import { GET as health } from "../app/api/health/route";
import { GET as floor } from "../app/api/floor/route";
import { POST as control } from "../app/api/control/route";
import { GET as inspector } from "../app/api/inspector/route";
import { killAll } from "../lib/workers";
import { resetStoreSingleton } from "../lib/get-store";

describe("API routes", () => {
  afterEach(() => {
    killAll();
    resetStoreSingleton();
  });

  it("health reports store and live pickers", async () => {
    process.env.STIGMERGY_STORE = "memory";
    delete process.env.DATABASE_URL;
    resetStoreSingleton();
    const res = await health();
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.store).toBe("memory");
  });

  it("floor snapshot includes insulin and the serializable grid", async () => {
    process.env.STIGMERGY_STORE = "memory";
    delete process.env.DATABASE_URL;
    resetStoreSingleton();
    const res = await floor(new Request("http://localhost/api/floor"));
    const json = await res.json();
    expect(json.width).toBe(12);
    expect(json.packages.some((p: { sku: string }) => p.sku === "INSULIN")).toBe(true);
    expect(json.cells.length).toBe(120);
  });

  it("spawn then inspector can see holdings", async () => {
    process.env.STIGMERGY_STORE = "memory";
    delete process.env.DATABASE_URL;
    resetStoreSingleton();
    const spawned = await control(
      new Request("http://localhost/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "spawn", count: 2, warehouseId: "test" }),
      }),
    );
    const body = await spawned.json();
    expect(body.ok).toBe(true);
    expect(body.live.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 50));
    const ins = await inspector(new Request("http://localhost/api/inspector?warehouse=test"));
    const data = await ins.json();
    expect(data.readOnly).toBe(true);
  });
});
