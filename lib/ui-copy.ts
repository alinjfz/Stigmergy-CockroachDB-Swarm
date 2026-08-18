import type { FloorEvent, Package } from "./types";

export type EventCopy = {
  title: string;
  why: string;
  /**
   * Decisive rows are the ones the product is actually about: a claim won or
   * lost. Routine rows are the constant background of pickers walking around.
   * The rail hides routine rows by default so the decisive ones stop scrolling
   * past unread.
   */
  weight: "decisive" | "routine";
};

const EVENT_PLAIN: Record<string, EventCopy> = {
  spawn: {
    title: "Picker started",
    why: "Claimed its own starting cell. Nothing assigned it a job.",
    weight: "routine",
  },
  step: {
    title: "Moved",
    why: "Took the next free cell.",
    weight: "routine",
  },
  claim_package: {
    title: "Won a package",
    why: "Its UPDATE returned 1 row, so no other picker can take this one.",
    weight: "decisive",
  },
  dead_end: {
    title: "Lost a package",
    why: "Its UPDATE returned 0 rows, so it wrote a dead-end scent — one row in the scents table — instead of asking anyone.",
    weight: "decisive",
  },
  jam: {
    title: "Lost a cell",
    why: "Another picker already held that square, so it recorded the block and went around.",
    weight: "decisive",
  },
  deliver: {
    title: "Delivered to the dock",
    why: "Marked the package delivered and let go of the cell.",
    weight: "decisive",
  },
};

export function describeEvent(type: string): EventCopy {
  return (
    EVENT_PLAIN[type] ?? {
      title: type.replaceAll("_", " "),
      why: "A row changed in the floor tables.",
      weight: "routine",
    }
  );
}

/**
 * The subject of the row. Two pickers racing for one box produce a won and a
 * lost line in the same second, so "Won a package" on its own reads as a
 * contradiction. Naming the SKU is what makes the pair legible.
 */
export function eventSubject(event: FloorEvent): string | null {
  const p = event.payload ?? {};
  const sku = typeof p.sku === "string" && p.sku.length > 0 ? p.sku : null;
  if (sku) return sku;
  if (event.event_type === "jam") return `${event.cell_x},${event.cell_y}`;
  return null;
}

export function isDecisive(type: string): boolean {
  return describeEvent(type).weight === "decisive";
}

export type Connection = {
  tone: "ok" | "warn" | "error" | "pending";
  label: string;
  /** Shown only when the user needs to act on it or distrust what they see. */
  detail: string | null;
};

/**
 * The header has to be able to say "this is real" or "this is not real". The
 * in-process fallback invalidates every durability claim the product makes, so
 * it is a warning rather than a caption.
 */
export function describeConnection(
  store: string | undefined,
  unreachable: boolean,
): Connection {
  if (unreachable) {
    return {
      tone: "error",
      label: "Lost the database connection",
      detail:
        "The floor below is frozen at the last state we managed to read. Nothing you see is live.",
    };
  }
  if (store === "cockroach") {
    return { tone: "ok", label: "Connected to CockroachDB", detail: null };
  }
  if (store === "memory") {
    return {
      tone: "warn",
      label: "Not connected to CockroachDB",
      detail:
        "Running on temporary in-app memory. Nothing here survives a restart, so the durability test below proves nothing. Set DATABASE_URL for the real thing.",
    };
  }
  return { tone: "pending", label: "Connecting…", detail: null };
}

/** Kept for the header caption; prefer describeConnection for anything new. */
export function memoryLabel(store: string | undefined): string {
  return describeConnection(store, false).label;
}

export function describePackageStatus(pkg: Package): string {
  if (pkg.status === "delivered") return "delivered";
  if (pkg.status === "claimed") {
    return pkg.claimed_by ? `being carried by ${pkg.claimed_by}` : "being carried";
  }
  return "on the shelf";
}

export function describeScentKind(kind: string): string {
  if (kind === "dead_end") return "dead end — a picker lost a package here";
  if (kind === "jam") return "jam — a picker lost this cell here";
  if (kind === "trail") return "trail — a delivery came through here";
  return kind.replaceAll("_", " ");
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--:--:--" : d.toISOString().slice(11, 19);
}

export type ConflictFacts = {
  cell: [number, number];
  loser: string | null;
  winner: string | null;
  label: string | null;
  reason: string | null;
};

/** Pull the human-readable facts of a lost claim out of the audit row. */
export function conflictFacts(event: FloorEvent): ConflictFacts {
  const p = event.payload ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    cell: [event.cell_x ?? 0, event.cell_y ?? 0],
    loser: event.picker_id,
    winner: str(p.winner),
    label: str(p.label) ?? str(p.sku),
    reason: str(p.reason),
  };
}
