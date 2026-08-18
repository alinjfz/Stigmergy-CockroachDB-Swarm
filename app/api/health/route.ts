import { NextResponse } from "next/server";
import { DEFAULT_WAREHOUSE } from "@/lib/config";
import { getStore } from "@/lib/get-store";
import { runningPickerIds } from "@/lib/workers";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  const live = await runningPickerIds(DEFAULT_WAREHOUSE);
  return NextResponse.json({
    ok: true,
    store: store.kind,
    livePickers: live.length,
    database: Boolean(process.env.DATABASE_URL),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
  });
}
