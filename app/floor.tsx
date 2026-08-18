"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FloorSnapshot } from "@/lib/types";
import styles from "./floor.module.css";

export function FloorView() {
  const [snap, setSnap] = useState<FloorSnapshot | null>(null);
  const [pulse, setPulse] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);
  const [lastKilled, setLastKilled] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/floor", { cache: "no-store" });
    if (!res.ok) return;
    setSnap((await res.json()) as FloorSnapshot);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 400);
    return () => clearInterval(t);
  }, [load]);

  const act = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = (await res.json()) as { killed?: string[]; ids?: string[] };
      if (action === "killHalf" && json.killed) setLastKilled(json.killed);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const cellMap = useMemo(() => {
    const m = new Map<string, FloorSnapshot["cells"][0]>();
    if (!snap) return m;
    for (const c of snap.cells) m.set(`${c.x},${c.y}`, c);
    return m;
  }, [snap]);

  const pkgMap = useMemo(() => {
    const m = new Map<string, FloorSnapshot["packages"][0]>();
    if (!snap) return m;
    for (const p of snap.packages) m.set(`${p.x},${p.y}`, p);
    return m;
  }, [snap]);

  const scentHeat = useMemo(() => {
    const m = new Map<string, { dead: number; trail: number; jam: number }>();
    if (!snap) return m;
    for (const s of snap.scents) {
      const k = `${s.cell_x},${s.cell_y}`;
      const cur = m.get(k) ?? { dead: 0, trail: 0, jam: 0 };
      if (s.kind === "dead_end") cur.dead += 1;
      else if (s.kind === "trail") cur.trail += 1;
      else cur.jam += 1;
      m.set(k, cur);
    }
    return m;
  }, [snap]);

  const cols = snap?.width ?? 12;
  const rows = snap?.height ?? 10;

  return (
    <div className={styles.shell}>
      <div className={styles.grain} aria-hidden />
      <header className={styles.hudTop}>
        <div>
          <p className={styles.kicker}>Dock B · night wave</p>
          <h1 className={styles.title}>Stigmergy</h1>
        </div>
        <p className={styles.caption}>SERIALIZABLE · memory = CockroachDB</p>
        <div className={styles.stats}>
          <span>{snap?.livePickers.length ?? 0} live</span>
          <span>{snap?.store ?? "…"}</span>
          <Link href="/inspector">inspector</Link>
        </div>
      </header>

      <main className={styles.stage}>
        <div
          className={styles.grid}
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {Array.from({ length: rows * cols }, (_, i) => {
            const x = i % cols;
            const y = Math.floor(i / cols);
            const key = `${x},${y}`;
            const cell = cellMap.get(key);
            const pkg = pkgMap.get(key);
            const heat = scentHeat.get(key);
            const live = snap?.livePickers.includes(cell?.reserved_by ?? "") ?? false;
            const locked = Boolean(cell?.reserved_by);
            const pulsed = pulse === key;
            return (
              <div
                key={key}
                className={[
                  styles.cell,
                  locked ? styles.locked : "",
                  live ? styles.alive : "",
                  pulsed ? styles.pulse : "",
                  x === 0 ? styles.dock : "",
                ].join(" ")}
                style={{
                  ["--dead" as string]: String(Math.min(1, (heat?.dead ?? 0) / 3)),
                  ["--trail" as string]: String(Math.min(1, (heat?.trail ?? 0) / 3)),
                  ["--jam" as string]: String(Math.min(1, (heat?.jam ?? 0) / 3)),
                }}
              >
                {locked ? <i className={styles.beetle} /> : null}
                {pkg && pkg.status !== "delivered" ? (
                  <b className={pkg.sku === "INSULIN" ? styles.insulin : styles.sku}>
                    {pkg.label}
                  </b>
                ) : null}
                <em>
                  {x},{y}
                </em>
              </div>
            );
          })}
        </div>

        <aside className={styles.rail}>
          <h2>Committed rows</h2>
          <p className={styles.railHint}>Not a chat. These are writes.</p>
          <ol>
            {(snap?.events ?? []).map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (e.cell_x === null || e.cell_y === null) return;
                    setPulse(`${e.cell_x},${e.cell_y}`);
                    window.setTimeout(() => setPulse(null), 900);
                  }}
                >
                  <span>
                    {new Date(e.at).toISOString().slice(11, 19)} · {e.picker_id ?? "—"} · {e.event_type}
                  </span>
                  <code>{e.sql_text}</code>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </main>

      <footer className={styles.strip}>
        <button type="button" disabled={busy} onClick={() => void act("spawn", { count: 8 })}>
          Spawn 8
        </button>
        <button
          type="button"
          className={confirmKill ? styles.dangerHot : styles.danger}
          disabled={busy}
          onClick={() => {
            if (!confirmKill) {
              setConfirmKill(true);
              if (confirmTimer.current) clearTimeout(confirmTimer.current);
              confirmTimer.current = setTimeout(() => setConfirmKill(false), 2200);
              return;
            }
            setConfirmKill(false);
            void act("killHalf");
          }}
        >
          {confirmKill ? "Confirm kill half" : "Kill half"}
        </button>
        <button
          type="button"
          disabled={busy || lastKilled.length === 0}
          onClick={() => void act("respawn", { ids: lastKilled })}
        >
          Respawn same ids
        </button>
        <button type="button" disabled={busy} onClick={() => void act("reset")}>
          Reset floor
        </button>
        <p className={styles.legend}>
          IR red = dead-end scent · amber = trail · cyan lock stays when process dies
        </p>
      </footer>
    </div>
  );
}
