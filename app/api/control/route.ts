import { NextResponse } from "next/server";
import { DEFAULT_SPAWN, DEFAULT_WAREHOUSE } from "@/lib/config";
import { getStore } from "@/lib/get-store";
import {
  killAll,
  killHalf,
  livePickerIds,
  respawnSame,
  spawnPickers,
} from "@/lib/workers";

export const dynamic = "force-dynamic";

type Body = {
  action: "spawn" | "killHalf" | "killAll" | "respawn" | "reset";
  count?: number;
  ids?: string[];
  warehouseId?: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const warehouseId = body.warehouseId ?? DEFAULT_WAREHOUSE;
  const store = getStore();
  await store.ensureSeeded(warehouseId);

  if (body.action === "spawn") {
    const ids = spawnPickers(body.count ?? DEFAULT_SPAWN, warehouseId);
    return NextResponse.json({ ok: true, ids, live: livePickerIds() });
  }
  if (body.action === "killHalf") {
    const killed = killHalf();
    return NextResponse.json({ ok: true, killed, live: livePickerIds() });
  }
  if (body.action === "killAll") {
    const killed = killAll();
    return NextResponse.json({ ok: true, killed, live: livePickerIds() });
  }
  if (body.action === "respawn") {
    const ids = respawnSame(body.ids ?? [], warehouseId);
    return NextResponse.json({ ok: true, ids, live: livePickerIds() });
  }
  if (body.action === "reset") {
    killAll();
    await store.reset(warehouseId);
    return NextResponse.json({ ok: true, live: [] });
  }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
