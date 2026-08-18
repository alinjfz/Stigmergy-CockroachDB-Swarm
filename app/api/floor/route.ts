import { NextResponse } from "next/server";
import { DEFAULT_WAREHOUSE } from "@/lib/config";
import { getStore } from "@/lib/get-store";
import { livePickerIds } from "@/lib/workers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const warehouseId = url.searchParams.get("warehouse") ?? DEFAULT_WAREHOUSE;
  const store = getStore();
  const snap = await store.snapshot(warehouseId, livePickerIds());
  return NextResponse.json(snap);
}
