import { DEFAULT_WAREHOUSE } from "./config";
import { embedText } from "./embed";
import { phraseScentReason } from "./openrouter";
import { chooseNextCell, nearestWaitingPackage } from "./policy";
import type { Store } from "./store";

export type TickResult = {
  pickerId: string;
  action: string;
};

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

  const dest = held
    ? { x: held.dest_x, y: held.dest_y }
    : (() => {
        const target = nearestWaitingPackage({ x: pos.x, y: pos.y }, packages);
        return target ? { x: target.x, y: target.y } : null;
      })();

  if (!dest) return { pickerId, action: "idle" };

  if (!held && pos.x === dest.x && pos.y === dest.y) {
    const pkg = packages.find((p) => p.x === dest.x && p.y === dest.y && p.status === "waiting");
    if (pkg) {
      const won = await store.claimPackage(warehouseId, pkg.id, pickerId);
      if (won) {
        await store.recordEvent({
          warehouse_id: warehouseId,
          picker_id: pickerId,
          event_type: "claim_package",
          cell_x: pos.x,
          cell_y: pos.y,
          package_id: pkg.id,
          sql_text: `UPDATE packages SET claimed_by='${pickerId}' WHERE id='${pkg.id}' AND claimed_by IS NULL AND status='waiting' RETURNING *`,
          payload: { sku: pkg.sku },
        });
        return { pickerId, action: "claimed" };
      }
      const reason = await phraseScentReason({
        kind: "dead_end",
        cell: { x: pos.x, y: pos.y },
        sku: pkg.sku,
      });
      const embedding = embedText(`${reason} last unit contested ${pkg.sku}`);
      await store.insertScent({
        warehouse_id: warehouseId,
        cell_x: pos.x,
        cell_y: pos.y,
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
        cell_x: pos.x,
        cell_y: pos.y,
        package_id: pkg.id,
        sql_text: `INSERT INTO scents (kind, reason, embedding) — loser of serializable claim`,
        payload: { sku: pkg.sku },
      });
      return { pickerId, action: "dead_end" };
    }
  }

  const queryText = held
    ? `carry ${held.sku} toward dock avoid jam`
    : `seek package jammed aisle last unit`;
  const queryEmbedding = embedText(queryText);
  const similar = await store.similarScents(warehouseId, queryEmbedding, 6);
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
      sql_text: `UPDATE cells SET reserved_by='${pickerId}' WHERE x=${next.x} AND y=${next.y} AND reserved_by IS NULL RETURNING * — 0 rows`,
      payload: {},
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
    sql_text: `UPDATE cells SET reserved_by='${pickerId}' WHERE x=${next.x} AND y=${next.y} AND reserved_by IS NULL RETURNING *`,
    payload: {},
  });
  return { pickerId, action: "step" };
}
