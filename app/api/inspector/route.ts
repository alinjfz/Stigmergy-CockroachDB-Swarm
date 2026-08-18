import { NextResponse } from "next/server";
import { DEFAULT_WAREHOUSE } from "@/lib/config";
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
  const insulin = snap.packages.find((p) => p.sku === "INSULIN");
  return NextResponse.json({
    readOnly: true,
    note: "Writes are denied here. Use Cockroach Cloud Managed MCP in Cursor for the same view.",
    insulin: insulin
      ? {
          id: insulin.id,
          status: insulin.status,
          claimed_by: insulin.claimed_by,
          cell: [insulin.x, insulin.y],
        }
      : null,
    holdings,
    lastEvents: snap.events.slice(0, 12),
  });
}
