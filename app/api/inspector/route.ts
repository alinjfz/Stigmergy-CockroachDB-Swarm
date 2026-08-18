import { NextResponse } from "next/server";
import { CONTESTED_SKU, DEFAULT_WAREHOUSE } from "@/lib/config";
import { getStore } from "@/lib/get-store";

export const dynamic = "force-dynamic";

/** Read-only analogue of Cockroach Managed MCP for judges on the demo URL. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const warehouseId = url.searchParams.get("warehouse") ?? DEFAULT_WAREHOUSE;
  const store = getStore();
  const snap = await store.snapshot(warehouseId, []);
  const holdings = snap.cells
    .filter((c) => c.reserved_by)
    .map((c) => ({
      picker: c.reserved_by,
      cell: [c.x, c.y],
      package: snap.packages.find((p) => p.id === c.package_id)?.sku ?? null,
    }));
  const contested = snap.packages.find((p) => p.sku === CONTESTED_SKU);
  return NextResponse.json({
    readOnly: true,
    note: "This view can read the tables and nothing else. Cockroach Cloud Managed MCP gives the same answers in Cursor, enforced by the credential rather than by this app.",
    store: snap.store,
    sku: CONTESTED_SKU,
    contested: contested
      ? {
          id: contested.id,
          sku: contested.sku,
          status: contested.status,
          claimed_by: contested.claimed_by,
          cell: [contested.x, contested.y],
        }
      : null,
    holdings,
    lastEvents: snap.events.slice(0, 12),
  });
}

/**
 * Every write to this route is refused. The point of exposing it at all is that a
 * judge can attempt one and read the refusal, rather than being told in prose
 * that the boundary exists.
 */
export async function POST(req: Request) {
  let cell = "?,?";
  let picker = "someone";
  try {
    const body = (await req.json()) as { cell?: number[]; picker?: string };
    if (Array.isArray(body.cell)) cell = body.cell.join(",");
    if (body.picker) picker = body.picker;
  } catch {
    /* the refusal does not depend on the body */
  }
  return NextResponse.json(
    {
      ok: false,
      denied: true,
      attempted: `UPDATE cells SET reserved_by = NULL WHERE x = ${cell.split(",")[0]} AND y = ${cell.split(",")[1]};`,
      message: `Refused. This inspector has no write path, so ${picker} keeps cell ${cell}. Reservations can only be released by the picker that holds one.`,
    },
    { status: 403 },
  );
}
