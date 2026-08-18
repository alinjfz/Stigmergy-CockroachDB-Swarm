import { NextResponse } from "next/server";
import { DEFAULT_WAREHOUSE } from "@/lib/config";
import { getStore } from "@/lib/get-store";
import { tickRunningPickers } from "@/lib/workers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const warehouseId = url.searchParams.get("warehouse") ?? DEFAULT_WAREHOUSE;
  const store = getStore();
  const live = await tickRunningPickers(warehouseId);
  const snap = await store.snapshot(warehouseId, live);
  return NextResponse.json(snap);
}
