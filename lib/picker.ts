import { DEFAULT_WAREHOUSE } from "./config";
import { embedText } from "./embed";
import { phraseScentReason } from "./openrouter";
import { chooseNextCell, nearestWaitingPackage, withinReach } from "./policy";
import { recallEnabled } from "./recall";
import type { Store } from "./store";
import type { Package } from "./types";

export type TickResult = {
  pickerId: string;
  action: string;
};

/**
 * Deliveries all land on column 0, so an idle picker parked there would block
 * them forever. It only has to step off that column: one move, then it stops for
 * good. Sending idle pickers further than this makes them chase parking spots and
 * thrash, which repeatedly invalidates the routes of pickers still carrying
 * something.
 */
const DOCK_COLUMN_X = 0;

async function spawnAtDock(store: Store, warehouseId: string, pickerId: string): Promise<boolean> {
  const n = Number(pickerId.replace(/\D/g, "")) || 0;
  const y = Math.min(9, n % 10);
  for (let x = 0; x <= 2; x++) {
    const claim = await store.claimCell(warehouseId, x, y, pickerId);
    if (claim.ok) {
      await store.recordEvent({
        warehouse_id: warehouseId,
        picker_id: pickerId,
        event_type: "spawn",
        cell_x: x,
        cell_y: y,
        package_id: null,
        sql_text: `UPDATE cells SET reserved_by='${pickerId}' WHERE x=${x} AND y=${y} AND reserved_by IS NULL RETURNING *`,
        payload: { store: store.kind },
      });
      return true;
    }
  }
  return false;
}

async function winnerOf(
  store: Store,
  warehouseId: string,
  packageId: string,
): Promise<string | null> {
  const rows: Package[] = await store.getPackages(warehouseId);
  return rows.find((p) => p.id === packageId)?.claimed_by ?? null;
}

export async function pickerTick(
  store: Store,
  pickerId: string,
  warehouseId = DEFAULT_WAREHOUSE,
): Promise<TickResult> {
  await store.ensureSeeded(warehouseId);

  let pos = await store.positionOf(warehouseId, pickerId);
  if (!pos) {
    const ok = await spawnAtDock(store, warehouseId, pickerId);
    if (!ok) return { pickerId, action: "spawn_blocked" };
    pos = await store.positionOf(warehouseId, pickerId);
    if (!pos) return { pickerId, action: "spawn_blocked" };
  }

  const held = await store.heldBy(warehouseId, pickerId);
  const packages = await store.getPackages(warehouseId);
  const cells = await store.getCells(warehouseId);

  if (held && pos.x === held.dest_x && pos.y === held.dest_y) {
    await store.deliverPackage(warehouseId, held.id, pickerId);
    const reason = await phraseScentReason({
      kind: "trail",
      cell: { x: pos.x, y: pos.y },
      sku: held.sku,
    });
    const embedding = embedText(reason);
    await store.insertScent({
      warehouse_id: warehouseId,
      cell_x: pos.x,
      cell_y: pos.y,
      kind: "trail",
      reason,
      picker_id: pickerId,
      wave: 1,
      embedding,
    });
    await store.recordEvent({
      warehouse_id: warehouseId,
      picker_id: pickerId,
      event_type: "deliver",
      cell_x: pos.x,
      cell_y: pos.y,
      package_id: held.id,
      sql_text: `UPDATE packages SET status='delivered' WHERE id='${held.id}' AND claimed_by='${pickerId}'`,
      payload: { sku: held.sku },
    });
    await store.releaseCell(warehouseId, pickerId);
    return { pickerId, action: "delivered" };
  }

  const target = held ? null : nearestWaitingPackage({ x: pos.x, y: pos.y }, packages);
  let dest = held
    ? { x: held.dest_x, y: held.dest_y }
    : target
      ? { x: target.x, y: target.y }
      : null;

  if (!dest) {
    // A picker with nothing to do still holds its cell. If that cell is a dock
    // door, every remaining delivery is blocked forever by a picker that has no
    // reason to move.
    if (pos.x > DOCK_COLUMN_X) return { pickerId, action: "idle" };
    dest = { x: DOCK_COLUMN_X + 1, y: pos.y };
  }

  if (!held) {
    // Optimistic concurrency: the packages read above is a hint, not the truth.
    // A picker that can reach a unit attempts the claim and lets the database
    // arbitrate, which is the only way a losing write can ever be observed.
    const inReach = packages.filter((p) => p.status !== "delivered" && withinReach(pos, p));
    const pkg =
      inReach.find((p) => p.id === target?.id) ??
      inReach.find((p) => p.status === "waiting") ??
      inReach[0];
    const alreadyLostThisOne =
      pkg && pkg.status !== "waiting"
        ? await store.hasScentFrom(warehouseId, { x: pkg.x, y: pkg.y }, "dead_end", pickerId)
        : false;
    if (pkg && pkg.claimed_by !== pickerId && !alreadyLostThisOne) {
      const claimSql = `UPDATE packages SET claimed_by='${pickerId}', status='claimed'\n  WHERE id='${pkg.id}' AND claimed_by IS NULL AND status='waiting'\n  RETURNING *;`;
      const won = await store.claimPackage(warehouseId, pkg.id, pickerId);
      if (won) {
        await store.recordEvent({
          warehouse_id: warehouseId,
          picker_id: pickerId,
          event_type: "claim_package",
          cell_x: pos.x,
          cell_y: pos.y,
          package_id: pkg.id,
          sql_text: `${claimSql}\n-- 1 row. This picker now holds ${pkg.sku}.`,
          payload: { sku: pkg.sku, label: pkg.label, rows: 1 },
        });
        return { pickerId, action: "claimed" };
      }

      const winner = await winnerOf(store, warehouseId, pkg.id);
      const reason = await phraseScentReason({
        kind: "dead_end",
        cell: { x: pkg.x, y: pkg.y },
        sku: pkg.sku,
      });
      const embedding = embedText(`${reason} last unit contested ${pkg.sku}`);
      await store.insertScent({
        warehouse_id: warehouseId,
        cell_x: pkg.x,
        cell_y: pkg.y,
        kind: "dead_end",
        reason,
        picker_id: pickerId,
        wave: 1,
        embedding,
      });
      await store.recordEvent({
        warehouse_id: warehouseId,
        picker_id: pickerId,
        event_type: "dead_end",
        cell_x: pkg.x,
        cell_y: pkg.y,
        package_id: pkg.id,
        sql_text: `${claimSql}\n-- 0 rows${winner ? `: ${winner} already holds it` : ""}.\nINSERT INTO scents (kind, reason, embedding)\n  VALUES ('dead_end', '${reason.replaceAll("'", "''")}', <384-d vector>);`,
        payload: { sku: pkg.sku, label: pkg.label, rows: 0, winner, reason },
      });
      return { pickerId, action: "dead_end" };
    }
  }

  const queryText = held
    ? `carry ${held.sku} toward dock avoid jam`
    : `seek package jammed aisle last unit`;
  const queryEmbedding = embedText(queryText);
  const recallOn = recallEnabled();
  const similar = recallOn ? await store.similarScents(warehouseId, queryEmbedding, 6) : [];
  const deadEnds = similar.filter((s) => s.kind === "dead_end" || s.kind === "jam");

  const next = chooseNextCell({
    from: { x: pos.x, y: pos.y },
    dest,
    selfId: pickerId,
    cells,
    similarDeadEnds: deadEnds,
    queryEmbedding,
  });

  if (!next) return { pickerId, action: "blocked" };

  const moved = await store.movePicker(warehouseId, pickerId, { x: pos.x, y: pos.y }, next);
  if (!moved.ok) {
    const reason = await phraseScentReason({
      kind: "jam",
      cell: next,
      sku: held?.sku,
    });
    const embedding = embedText(`${reason} blocked cell ${next.x},${next.y}`);
    await store.insertScent({
      warehouse_id: warehouseId,
      cell_x: next.x,
      cell_y: next.y,
      kind: "jam",
      reason,
      picker_id: pickerId,
      wave: 1,
      embedding,
    });
    await store.recordEvent({
      warehouse_id: warehouseId,
      picker_id: pickerId,
      event_type: "jam",
      cell_x: next.x,
      cell_y: next.y,
      package_id: held?.id ?? null,
      sql_text: `UPDATE cells SET reserved_by='${pickerId}'\n  WHERE x=${next.x} AND y=${next.y} AND reserved_by IS NULL\n  RETURNING *;\n-- 0 rows. Another picker holds that cell.`,
      payload: { rows: 0, recall: recallOn ? "on" : "off" },
    });
    return { pickerId, action: "jam" };
  }

  await store.recordEvent({
    warehouse_id: warehouseId,
    picker_id: pickerId,
    event_type: "step",
    cell_x: next.x,
    cell_y: next.y,
    package_id: held?.id ?? null,
    sql_text: `UPDATE cells SET reserved_by='${pickerId}'\n  WHERE x=${next.x} AND y=${next.y} AND reserved_by IS NULL\n  RETURNING *;\n-- 1 row.`,
    payload: {
      rows: 1,
      recall: recallOn ? "on" : "off",
      recalled: similar.length,
      warnings: deadEnds.length,
    },
  });
  return { pickerId, action: "step" };
}
