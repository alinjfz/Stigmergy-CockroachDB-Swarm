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

export function occupancyMap(cells: Cell[]): Map<string, Cell> {
  const m = new Map<string, Cell>();
  for (const c of cells) m.set(`${c.x},${c.y}`, c);
  return m;
}

export function isFree(cell: Cell | undefined, selfId: string): boolean {
  if (!cell) return true;
  return cell.reserved_by === null || cell.reserved_by === selfId;
}

/**
 * Score a candidate cell: closer to dest is better; similar dead-end scents
 * nearby are a penalty (the swarm "smells" past jams).
 */
export function scoreCell(opts: {
  cell: AdjacentCell;
  dest: AdjacentCell;
  selfId: string;
  occ: Map<string, Cell>;
  similarDeadEnds: Scent[];
  queryEmbedding: number[];
}): number {
  const key = `${opts.cell.x},${opts.cell.y}`;
  const occ = opts.occ.get(key);
  if (!isFree(occ, opts.selfId)) return Number.NEGATIVE_INFINITY;

  let score = 100 - manhattan(opts.cell.x, opts.cell.y, opts.dest.x, opts.dest.y) * 4;

  for (const scent of opts.similarDeadEnds) {
    const dist = manhattan(opts.cell.x, opts.cell.y, scent.cell_x, scent.cell_y);
    if (dist > 2) continue;
    const sim = cosine(opts.queryEmbedding, scent.embedding);
    const heat = Math.max(0, sim);
    score -= heat * (3 - dist) * 40;
  }
  return score;
}

export function chooseNextCell(opts: {
  from: AdjacentCell;
  dest: AdjacentCell;
  selfId: string;
  cells: Cell[];
  similarDeadEnds: Scent[];
  queryEmbedding: number[];
}): AdjacentCell | null {
  const occ = occupancyMap(opts.cells);
  const candidates = neighbors(opts.from.x, opts.from.y);
  let best: AdjacentCell | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    const s = scoreCell({
      cell: c,
      dest: opts.dest,
      selfId: opts.selfId,
      occ,
      similarDeadEnds: opts.similarDeadEnds,
      queryEmbedding: opts.queryEmbedding,
    });
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (bestScore === Number.NEGATIVE_INFINITY) return null;
  return best;
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
