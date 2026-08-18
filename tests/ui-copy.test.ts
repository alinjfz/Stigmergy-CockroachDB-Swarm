import { describe, expect, it } from "vitest";
import { describeConnection, describeEvent, isDecisive, memoryLabel } from "../lib/ui-copy";

describe("ui copy", () => {
  it("explains dead_end without saying chat", () => {
    const d = describeEvent("dead_end");
    expect(d.title.toLowerCase()).toContain("lost");
    expect(d.why.toLowerCase()).toContain("scent");
    expect(d.why.toLowerCase()).not.toContain("chat");
  });

  it("marks won and lost claims as decisive and walking as routine", () => {
    expect(isDecisive("dead_end")).toBe(true);
    expect(isDecisive("claim_package")).toBe(true);
    expect(isDecisive("jam")).toBe(true);
    expect(isDecisive("step")).toBe(false);
  });

  it("names cockroach as the memory", () => {
    expect(memoryLabel("cockroach")).toMatch(/CockroachDB/);
  });

  it("treats the in-process fallback as a warning, not a caption", () => {
    const c = describeConnection("memory", false);
    expect(c.tone).toBe("warn");
    expect(c.label).toMatch(/Not connected/);
    // The user has to be told that durability claims do not hold in this mode.
    expect(c.detail).toMatch(/survives a restart/);
  });

  it("reports an unreachable database instead of showing stale state silently", () => {
    const c = describeConnection("cockroach", true);
    expect(c.tone).toBe("error");
    expect(c.detail).toMatch(/frozen/);
  });

  it("does not claim a connection before one is known", () => {
    expect(describeConnection(undefined, false).tone).toBe("pending");
  });
});
