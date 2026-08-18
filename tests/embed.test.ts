import { describe, expect, it } from "vitest";
import { cosine, embedText } from "../lib/embed";
import { EMBEDDING_DIMS } from "../lib/config";

describe("embedText", () => {
  it("returns a 384-d unit vector", () => {
    const v = embedText("jammed at aisle C last spare");
    expect(v).toHaveLength(EMBEDDING_DIMS);
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 5);
  });

  it("places similar jam phrases closer than unrelated ones", () => {
    const a = embedText("dead-end jammed aisle C last spare wave 1");
    const b = embedText("blocked aisle C spare contested last unit");
    const c = embedText("picnic weather forecast sunny beaches");
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });

  it("is deterministic", () => {
    expect(embedText("hello")).toEqual(embedText("hello"));
  });
});
