import { describe, expect, it } from "vitest";
import { chooseNextCell, manhattan, nearestWaitingPackage, neighbors } from "../lib/policy";
import type { Cell, Scent } from "../lib/types";
import { embedText } from "../lib/embed";

function cell(x: number, y: number, reserved_by: string | null = null): Cell {
  return {
    warehouse_id: "default",
    x,
    y,
    package_id: null,
    reserved_by,
    reserved_at: reserved_by ? new Date().toISOString() : null,
  };
}

describe("policy", () => {
  it("lists four-way neighbors inside the grid", () => {
    expect(neighbors(0, 0)).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it("manhattan distance", () => {
    expect(manhattan(0, 0, 3, 4)).toBe(7);
  });

  it("walks toward dest when the path is free", () => {
    const next = chooseNextCell({
      from: { x: 2, y: 4 },
      dest: { x: 9, y: 4 },
      selfId: "p1",
      cells: [cell(2, 4, "p1")],
      similarDeadEnds: [],
      queryEmbedding: embedText("seek"),
    });
    expect(next).toEqual({ x: 3, y: 4 });
  });

  it("does not step onto a foreign reservation", () => {
    const next = chooseNextCell({
      from: { x: 2, y: 4 },
      dest: { x: 9, y: 4 },
      selfId: "p1",
      cells: [cell(2, 4, "p1"), cell(3, 4, "p2")],
      similarDeadEnds: [],
      queryEmbedding: embedText("seek"),
    });
    expect(next).not.toEqual({ x: 3, y: 4 });
    expect(next).not.toBeNull();
  });

  it("penalizes cells that smell like a nearby dead-end", () => {
    const query = embedText("jammed aisle last spare");
    const scent: Scent = {
      id: "s1",
      warehouse_id: "default",
      cell_x: 3,
      cell_y: 4,
      kind: "dead_end",
      reason: "jammed aisle last spare contested",
      picker_id: "p9",
      wave: 1,
      embedding: embedText("jammed aisle last spare contested"),
      created_at: new Date().toISOString(),
    };
    const next = chooseNextCell({
      from: { x: 2, y: 4 },
      dest: { x: 9, y: 4 },
      selfId: "p1",
      cells: [cell(2, 4, "p1")],
      similarDeadEnds: [scent],
      queryEmbedding: query,
    });
    expect(next).not.toEqual({ x: 3, y: 4 });
  });

  it("picks the nearest waiting package", () => {
    const p = nearestWaitingPackage({ x: 0, y: 0 }, [
      { x: 8, y: 8, status: "waiting" },
      { x: 2, y: 0, status: "waiting" },
      { x: 1, y: 0, status: "delivered" },
    ]);
    expect(p?.x).toBe(2);
  });
});
