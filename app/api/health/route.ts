import { NextResponse } from "next/server";
import { getStore } from "@/lib/get-store";
import { livePickerIds } from "@/lib/workers";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  return NextResponse.json({
    ok: true,
    store: store.kind,
    livePickers: livePickerIds().length,
    database: Boolean(process.env.DATABASE_URL),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
  });
}
