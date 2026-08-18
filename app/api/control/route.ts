import { NextResponse } from "next/server";
import {
  CONTESTED_CELL,
  CONTESTED_LABEL,
  CONTESTED_SKU,
  DEFAULT_SPAWN,
  DEFAULT_WAREHOUSE,
  DOCK_DOORS,
} from "@/lib/config";
import { getStore } from "@/lib/get-store";
import { neighbors } from "@/lib/policy";
import { recallEnabled, setRecallEnabled } from "@/lib/recall";
import type { Store } from "@/lib/store";
import {
  freePickerIds,
  killAll,
  killHalf,
  livePickerIds,
  respawnSame,
  spawnPickers,
  startPicker,
} from "@/lib/workers";

export const dynamic = "force-dynamic";

type Body = {
  action: "spawn" | "killHalf" | "killAll" | "respawn" | "reset" | "conflict" | "recall";
  count?: number;
  ids?: string[];
  on?: boolean;
  warehouseId?: string;
};

function fail(message: string, status = 409) {
  return NextResponse.json({ ok: false, message }, { status });
}

/**
 * Put two idle pickers on cells either side of one waiting package. Nothing tells
 * them to want it — each independently finds it as its nearest target. The
 * database is what decides which of them gets it.
 */
async function stageConflict(store: Store, warehouseId: string) {
  const packages = await store.getPackages(warehouseId);
  const existing = packages.find((p) => p.sku === CONTESTED_SKU && p.status === "waiting");

  // If the floor has already been cleared, restock one unit rather than refusing.
  // A warehouse getting a single new item is honest, and it keeps the experiment
  // repeatable without wiping the evidence the user has already collected.
  const pkg =
    existing ??
    (await store.addPackage(warehouseId, {
      sku: CONTESTED_SKU,
      label: CONTESTED_LABEL,
      x: CONTESTED_CELL.x,
      y: CONTESTED_CELL.y,
      dest_x: 0,
      dest_y: DOCK_DOORS[Math.floor(DOCK_DOORS.length / 2)],
    }));

  const ids = freePickerIds(2);
  if (ids.length < 2) {
    return fail("All picker slots are already running. Stop some pickers first.");
  }

  const placed: { id: string; x: number; y: number }[] = [];
  for (const spot of neighbors(pkg.x, pkg.y)) {
    if (placed.length === 2) break;
    const id = ids[placed.length];
    const claim = await store.claimCell(warehouseId, spot.x, spot.y, id);
    if (claim.ok) placed.push({ id, x: spot.x, y: spot.y });
  }

  if (placed.length < 2) {
    for (const p of placed) await store.releaseCell(warehouseId, p.id);
    return fail(
      `Not enough free space beside ${pkg.sku} to place two pickers. Wait a moment or reset the floor.`,
    );
  }

  for (const p of placed) {
    await store.recordEvent({
      warehouse_id: warehouseId,
      picker_id: p.id,
      event_type: "spawn",
      cell_x: p.x,
      cell_y: p.y,
      package_id: null,
      sql_text: `UPDATE cells SET reserved_by='${p.id}'\n  WHERE x=${p.x} AND y=${p.y} AND reserved_by IS NULL\n  RETURNING *;\n-- 1 row.`,
      payload: { store: store.kind, staged: true, beside: pkg.sku },
    });
    startPicker(p.id, warehouseId);
  }

  return NextResponse.json({
    ok: true,
    conflict: {
      sku: pkg.sku,
      label: pkg.label,
      cell: [pkg.x, pkg.y],
      pickers: placed.map((p) => p.id),
    },
    live: livePickerIds(),
  });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const warehouseId = body.warehouseId ?? DEFAULT_WAREHOUSE;

  try {
    const store = getStore();
    await store.ensureSeeded(warehouseId);

    if (body.action === "spawn") {
      const ids = spawnPickers(body.count ?? DEFAULT_SPAWN, warehouseId);
      const live = livePickerIds();
      if (ids.length === 0) {
        return fail(
          `All ${live.length} picker slots are already running. Stop some pickers before starting more.`,
        );
      }
      return NextResponse.json({ ok: true, ids, live });
    }
    if (body.action === "conflict") {
      return await stageConflict(store, warehouseId);
    }
    if (body.action === "recall") {
      setRecallEnabled(body.on !== false);
      return NextResponse.json({ ok: true, recallEnabled: recallEnabled() });
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
      setRecallEnabled(true);
      await store.reset(warehouseId);
      return NextResponse.json({ ok: true, live: [] });
    }
    return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("control failed", body.action, err);
    return NextResponse.json(
      {
        ok: false,
        message:
          "The database rejected that. The floor you can see is the last state we managed to read.",
      },
      { status: 500 },
    );
  }
}
