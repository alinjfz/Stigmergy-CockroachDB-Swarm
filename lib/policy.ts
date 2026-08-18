import { GRID_HEIGHT, GRID_WIDTH } from "./config";
import { cosine } from "./embed";
import type { AdjacentCell, Cell, Scent } from "./types";

export function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function neighbors(x: number, y: number): AdjacentCell[] {
  const out: AdjacentCell[] = [];
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < GRID_WIDTH && ny < GRID_HEIGHT) {
      out.push({ x: nx, y: ny });
    }
  }
  return out;
}

/**
 * A picker can reach a shelf it is standing next to, not only one it is standing
 * on. This is what lets two pickers want the same package at the same instant:
 * the cell lock stops them sharing a square, but it cannot stop them both
 * reaching for the same unit. The package claim has to settle that.
 */
export function withinReach(
  from: AdjacentCell,
  target: { x: number; y: number },
): boolean {
  return manhattan(from.x, from.y, target.x, target.y) <= 1;
}

export function occupancyMap(cells: Cell[]): Map<string, Cell> {
  const m = new Map<string, Cell>();
  for (const c of cells) m.set(`${c.x},${c.y}`, c);
  return m;
}

export function isFree(cell: Cell | undefined, selfId: string): boolean {
  if (!cell) return true;
  return cell.reserved_by === null || cell.reserved_by === selfId;
}

/** How many extra steps a picker will walk to avoid one strongly recalled failure. */
const SCENT_COST = 10;

/**
 * What it costs to walk into a cell. One for the step, plus the strength of any
 * similar dead-end or jam remembered near it.
 */
export function cellCost(opts: {
  cell: AdjacentCell;
  similarDeadEnds: Scent[];
  queryEmbedding: number[];
}): number {
  let cost = 1;
  for (const scent of opts.similarDeadEnds) {
    const dist = manhattan(opts.cell.x, opts.cell.y, scent.cell_x, scent.cell_y);
    if (dist > 2) continue;
    const heat = Math.max(0, cosine(opts.queryEmbedding, scent.embedding));
    cost += heat * (3 - dist) * SCENT_COST;
  }
  return cost;
}

/**
 * Cheapest route to the destination, returning only the first step of it.
 *
 * This is a shortest-path search rather than a greedy hill climb, and that choice
 * is load-bearing. Greedy stepping plus a scent field strong enough to actually
 * divert anyone produces local minima: carriers oscillate between two cells and
 * the floor never clears. Costing a whole path means a picker takes a visibly
 * longer way around a remembered failure and still arrives.
 */
export function chooseNextCell(opts: {
  from: AdjacentCell;
  dest: AdjacentCell;
  selfId: string;
  cells: Cell[];
  similarDeadEnds: Scent[];
  queryEmbedding: number[];
}): AdjacentCell | null {
  const occ = occupancyMap(opts.cells);
  const k = (c: { x: number; y: number }) => `${c.x},${c.y}`;
  const passable = (c: AdjacentCell) => isFree(occ.get(k(c)), opts.selfId);

  // A shelf cell can be held by whoever is standing on it, and a picker only has
  // to get next to a package to reach it. So an unreachable goal degrades to the
  // cheapest cell beside it rather than to "blocked".
  const goals = passable(opts.dest)
    ? [opts.dest]
    : neighbors(opts.dest.x, opts.dest.y).filter(passable);
  if (goals.length === 0) return null;
  const goalKeys = new Set(goals.map(k));

  const best = new Map<string, number>([[k(opts.from), 0]]);
  const firstStep = new Map<string, AdjacentCell>();
  const queue: { cell: AdjacentCell; cost: number }[] = [{ cell: opts.from, cost: 0 }];
  const done = new Set<string>();

  while (queue.length > 0) {
    // The grid is 120 cells, so a linear scan is cheaper than a heap.
    let pick = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[pick].cost) pick = i;
    }
    const { cell, cost } = queue.splice(pick, 1)[0];
    const ck = k(cell);
    if (done.has(ck)) continue;
    done.add(ck);

    if (goalKeys.has(ck) && ck !== k(opts.from)) return firstStep.get(ck) ?? null;

    for (const n of neighbors(cell.x, cell.y)) {
      const nk = k(n);
      if (done.has(nk) || !passable(n)) continue;
      const next = cost + cellCost({
        cell: n,
        similarDeadEnds: opts.similarDeadEnds,
        queryEmbedding: opts.queryEmbedding,
      });
      if (next < (best.get(nk) ?? Number.POSITIVE_INFINITY)) {
        best.set(nk, next);
        firstStep.set(nk, ck === k(opts.from) ? n : firstStep.get(ck)!);
        queue.push({ cell: n, cost: next });
      }
    }
  }

  // Fully walled in this tick. The caller records a block and tries again.
  return null;
}

export function nearestWaitingPackage<T extends { x: number; y: number; status: string }>(
  from: AdjacentCell,
  packages: T[],
): T | null {
  const waiting = packages.filter((p) => p.status === "waiting");
  if (waiting.length === 0) return null;
  return waiting.reduce((a, b) =>
    manhattan(from.x, from.y, a.x, a.y) <= manhattan(from.x, from.y, b.x, b.y) ? a : b,
  );
}
