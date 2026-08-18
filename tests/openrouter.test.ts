import { describe, expect, it, vi } from "vitest";
import {
  heuristicTieBreak,
  openRouterTieBreak,
  parseCellChoice,
  phraseScentReason,
} from "../lib/openrouter";

describe("openrouter helpers", () => {
  it("parses an x,y pair from model text", () => {
    expect(parseCellChoice("go to 4, 7 please", [{ x: 4, y: 7 }])).toEqual({ x: 4, y: 7 });
    expect(parseCellChoice("nope", [{ x: 1, y: 1 }])).toBeNull();
  });

  it("heuristic prefers closer dest", () => {
    const pick = heuristicTieBreak({
      pickerId: "p1",
      from: { x: 0, y: 0 },
      dest: { x: 5, y: 0 },
      options: [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
    });
    expect(pick).toEqual({ x: 1, y: 0 });
  });

  it("falls back when no API key", async () => {
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const reason = await phraseScentReason({ kind: "dead_end", cell: { x: 9, y: 4 }, sku: "SPARE" });
    expect(reason).toContain("(9,4)");
    const fetchImpl = vi.fn();
    const tie = await openRouterTieBreak(
      {
        pickerId: "p1",
        from: { x: 0, y: 0 },
        dest: { x: 2, y: 0 },
        options: [{ x: 1, y: 0 }],
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tie).toEqual({ x: 1, y: 0 });
    if (prev) process.env.OPENROUTER_API_KEY = prev;
  });

  it("uses the model when the key is set and falls back on HTTP error", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    }));
    const reason = await phraseScentReason({
      kind: "jam",
      cell: { x: 1, y: 1 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalled();
    expect(reason).toContain("(1,1)");
    delete process.env.OPENROUTER_API_KEY;
  });

  it("parses a successful tie-break response", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "3,4" } }] }),
    }));
    const tie = await openRouterTieBreak(
      {
        pickerId: "p1",
        from: { x: 2, y: 4 },
        dest: { x: 9, y: 4 },
        options: [
          { x: 2, y: 5 },
          { x: 3, y: 4 },
        ],
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(tie).toEqual({ x: 3, y: 4 });
    delete process.env.OPENROUTER_API_KEY;
  });
});
