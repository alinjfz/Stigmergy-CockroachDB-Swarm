export type Cell = {
  warehouse_id: string;
  x: number;
  y: number;
  package_id: string | null;
  reserved_by: string | null;
  reserved_at: string | null;
};

export type Package = {
  id: string;
  warehouse_id: string;
  sku: string;
  label: string;
  x: number;
  y: number;
  dest_x: number;
  dest_y: number;
  status: "waiting" | "claimed" | "delivered";
  claimed_by: string | null;
  claimed_at: string | null;
};

export type Scent = {
  id: string;
  warehouse_id: string;
  cell_x: number;
  cell_y: number;
  kind: "dead_end" | "trail" | "jam";
  reason: string;
  picker_id: string | null;
  wave: number;
  embedding: number[];
  created_at: string;
};

export type FloorEvent = {
  id: string;
  warehouse_id: string;
  at: string;
  picker_id: string | null;
  event_type: string;
  cell_x: number | null;
  cell_y: number | null;
  package_id: string | null;
  sql_text: string | null;
  payload: Record<string, unknown> | null;
};

/**
 * Totals read straight out of the tables, so the interface can show how much has
 * actually been written rather than how much happens to fit in the event window.
 */
export type FloorCounts = {
  /** Rows in floor_events. Every picker action appends one. */
  events: number;
  /** Rows in scents, including the vector column. */
  scents: number;
  /** Lost package claims: the moments the whole demo is about. */
  deadEnds: number;
  /** Lost cell claims. */
  jams: number;
  /** dead_end + jam in the last 30 seconds, for the recall comparison. */
  failedClaimsRecent: number;
  /**
   * Messages sent between pickers. Structurally zero: there is no code path in
   * this repo that sends one. Kept as a field so the UI can show it as a count
   * rather than a claim.
   */
  messages: 0;
};

export type FloorSnapshot = {
  warehouseId: string;
  width: number;
  height: number;
  cells: Cell[];
  packages: Package[];
  scents: Scent[];
  events: FloorEvent[];
  livePickers: string[];
  wave: number;
  store: "cockroach" | "memory";
  counts: FloorCounts;
  /** False while the operator has past-failure recall switched off. */
  recallEnabled: boolean;
};

export type ClaimResult =
  | { ok: true; cell: Cell }
  | { ok: false; reason: "occupied" | "missing" };

export type AdjacentCell = { x: number; y: number };
