"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONTESTED_SKU, DEFAULT_SPAWN } from "@/lib/config";
import {
  conflictFacts,
  describeConnection,
  describeEvent,
  eventSubject,
  describePackageStatus,
  describeScentKind,
  formatClock,
  isDecisive,
} from "@/lib/ui-copy";
import type { Cell, FloorEvent, FloorSnapshot, Package } from "@/lib/types";
import styles from "./floor.module.css";

const SQL_KEY = "stigmergy-show-sql";
const MAX_CARDS = 5;
const MAX_CONFLICT_CARDS = 2;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

type Card =
  | { id: string; kind: "conflict"; event: FloorEvent }
  | { id: string; kind: "durability"; stopped: string[] }
  | { id: string; kind: "resume"; ids: string[] }
  | { id: string; kind: "recall"; on: boolean }
  | { id: string; kind: "note"; message: string };

export function FloorView() {
  const [snap, setSnap] = useState<FloorSnapshot | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [pulse, setPulse] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState("0,0");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [showEveryMove, setShowEveryMove] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const seenConflicts = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SQL_KEY) === "1") setShowSql(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSql = () => {
    setShowSql((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(SQL_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const pushCard = useCallback((card: Card) => {
    setCards((prev) => [card, ...prev].slice(0, MAX_CARDS));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/floor", { cache: "no-store" });
      if (!res.ok) {
        setUnreachable(true);
        return;
      }
      setSnap((await res.json()) as FloorSnapshot);
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 500);
    return () => clearInterval(t);
  }, [load]);

  // A lost claim is the whole argument, so every one of them gets a card that
  // stays put — whether the user staged it or the swarm produced it on its own.
  useEffect(() => {
    if (!snap) return;
    const losses = snap.events.filter((e) => e.event_type === "dead_end");
    if (!primed.current) {
      primed.current = true;
      for (const e of losses) seenConflicts.current.add(e.id);
      return;
    }
    const fresh = losses.filter((e) => !seenConflicts.current.has(e.id));
    if (fresh.length === 0) return;
    for (const e of fresh) seenConflicts.current.add(e.id);
    setCards((prev) => {
      const next = [
        ...fresh.slice(0, MAX_CONFLICT_CARDS).map((e) => ({ id: e.id, kind: "conflict" as const, event: e })),
        ...prev,
      ];
      // One worked example teaches the mechanism; a stack of them buries the rest
      // of the panel and reads as noise. Volume belongs in the counter.
      let shown = 0;
      return next
        .filter((c) => c.kind !== "conflict" || ++shown <= MAX_CONFLICT_CARDS)
        .slice(0, MAX_CARDS);
    });
  }, [snap]);

  const act = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        killed?: string[];
        ids?: string[];
        live?: string[];
        conflict?: { sku: string; label: string; cell: number[]; pickers: string[] };
        recallEnabled?: boolean;
      };

      if (!res.ok || json.ok === false) {
        const message = json.message ?? "That did not work. Nothing on the floor changed.";
        setNote(message);
        pushCard({ id: `note-${Date.now()}`, kind: "note", message });
        return;
      }

      if (action === "spawn") {
        setNote(
          `${json.ids?.length ?? 0} pickers are running. Each one reads the same table and claims its own cells.`,
        );
      }
      if (action === "conflict" && json.conflict) {
        const { label, pickers, cell } = json.conflict;
        setNote(
          `${pickers.join(" and ")} are both standing next to ${label} at ${cell.join(",")}. The database decides which one gets it.`,
        );
        setSelected(cellKey(cell[0], cell[1]));
      }
      if (action === "killHalf") {
        const stopped = json.killed ?? [];
        setNote(
          `Stopped ${stopped.length} picker loops. Their cell reservations are still in the database.`,
        );
        pushCard({ id: `dur-${Date.now()}`, kind: "durability", stopped });
      }
      if (action === "respawn") {
        setNote("The same pickers are back. They read their position out of the table and carried on.");
        pushCard({ id: `res-${Date.now()}`, kind: "resume", ids: json.ids ?? [] });
      }
      if (action === "recall") {
        const on = json.recallEnabled !== false;
        setNote(
          on
            ? "Pickers are reading past failures again."
            : "Pickers are no longer reading past failures. Watch the failed-claim count.",
        );
        pushCard({ id: `rec-${Date.now()}`, kind: "recall", on });
      }
      if (action === "reset") {
        setNote("Floor reset. Packages are back on the shelves.");
        setCards([]);
        seenConflicts.current.clear();
      }
      await load();
    } catch {
      const message = "Could not reach the server. Nothing on the floor changed.";
      setNote(message);
      pushCard({ id: `note-${Date.now()}`, kind: "note", message });
    } finally {
      setBusy(false);
    }
  };

  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of snap?.cells ?? []) m.set(cellKey(c.x, c.y), c);
    return m;
  }, [snap]);

  /** Where each picker currently is, so a carried package travels with it. */
  const pickerPos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const c of snap?.cells ?? []) {
      if (c.reserved_by) m.set(c.reserved_by, { x: c.x, y: c.y });
    }
    return m;
  }, [snap]);

  const pkgAt = useMemo(() => {
    const m = new Map<string, Package>();
    for (const p of snap?.packages ?? []) {
      if (p.status === "waiting") {
        m.set(cellKey(p.x, p.y), p);
      } else if (p.status === "claimed" && p.claimed_by) {
        const pos = pickerPos.get(p.claimed_by);
        if (pos) m.set(cellKey(pos.x, pos.y), p);
      }
    }
    return m;
  }, [snap, pickerPos]);

  const scentHeat = useMemo(() => {
    const m = new Map<string, { dead: number; trail: number; jam: number }>();
    for (const s of snap?.scents ?? []) {
      const k = cellKey(s.cell_x, s.cell_y);
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
  const live = useMemo(() => new Set(snap?.livePickers ?? []), [snap]);
  const liveCount = live.size;
  const onShelf = snap?.packages.filter((p) => p.status === "waiting").length ?? 0;
  const carried = snap?.packages.filter((p) => p.status === "claimed").length ?? 0;
  const delivered = snap?.packages.filter((p) => p.status === "delivered").length ?? 0;
  const total = snap?.packages.length ?? 0;
  const counts = snap?.counts;
  const recallOn = snap?.recallEnabled !== false;
  const conn = describeConnection(snap?.store, unreachable);

  /**
   * A picker holding a cell while its loop is gone is exactly what "restart the
   * same pickers" acts on. Deriving it from the table rather than React state
   * means the control still works after a page refresh.
   */
  const stoppedHolders = useMemo(() => {
    const held = new Set<string>();
    for (const c of snap?.cells ?? []) {
      if (c.reserved_by && !live.has(c.reserved_by)) held.add(c.reserved_by);
    }
    return [...held].sort();
  }, [snap, live]);

  const allDelivered = total > 0 && delivered === total;

  /**
   * Read from the snapshot rather than from what the last click claimed, so the
   * line still tells the truth after a refresh, after a loop dies on its own, or
   * when something else drives the floor.
   */
  // Let the message from the last click stand long enough to be read, then hand
  // the line back to the floor's own state.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(t);
  }, [note]);

  const liveStatus = useMemo(() => {
    if (unreachable) return "The database is unreachable. The floor below is the last state we read.";
    if (!snap) return "Reading the floor out of the database…";
    if (allDelivered) {
      return `Every package is at the dock. ${(counts?.events ?? 0) + (counts?.scents ?? 0)} database rows written, 0 messages between pickers.`;
    }
    if (liveCount === 0) {
      return stoppedHolders.length > 0
        ? `No picker loops are running. ${stoppedHolders.length} cell reservations are still held in the database.`
        : "Nothing is running yet.";
    }
    return `${liveCount} picker ${liveCount === 1 ? "loop is" : "loops are"} running. Each one reads the same table and claims its own cells.`;
  }, [unreachable, snap, allDelivered, counts, liveCount, stoppedHolders.length]);

  const selectedParts = useMemo(() => {
    if (!selected || !snap) return null;
    const [xs, ys] = selected.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const cell = cellMap.get(selected);
    const pkg = pkgAt.get(selected) ?? snap.packages.find((p) => p.id === cell?.package_id);
    const scents = snap.scents.filter((s) => s.cell_x === x && s.cell_y === y);
    return { x, y, cell, pkg, scents, running: live.has(cell?.reserved_by ?? "") };
  }, [selected, snap, cellMap, pkgAt, live]);

  // Races that happened but no longer have a card of their own, so the panel
  // never implies the total is only what is on screen.
  const olderRaces = Math.max(
    0,
    (counts?.deadEnds ?? 0) - cards.filter((c) => c.kind === "conflict").length,
  );

  const visibleEvents = useMemo(() => {
    const all = snap?.events ?? [];
    return showEveryMove ? all : all.filter((e) => isDecisive(e.event_type));
  }, [snap, showEveryMove]);

  const flashCell = (x: number | null, y: number | null) => {
    if (x === null || y === null) return;
    const k = cellKey(x, y);
    setPulse(k);
    setSelected(k);
    setFocusKey(k);
    window.setTimeout(() => setPulse(null), 900);
  };

  // Roving tabindex: one stop for the whole grid, arrows to move within it.
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const [fx, fy] = focusKey.split(",").map(Number);
    let nx = fx;
    let ny = fy;
    if (e.key === "ArrowRight") nx = Math.min(cols - 1, fx + 1);
    else if (e.key === "ArrowLeft") nx = Math.max(0, fx - 1);
    else if (e.key === "ArrowDown") ny = Math.min(rows - 1, fy + 1);
    else if (e.key === "ArrowUp") ny = Math.max(0, fy - 1);
    else if (e.key === "Home") nx = 0;
    else if (e.key === "End") nx = cols - 1;
    else return;
    e.preventDefault();
    const next = cellKey(nx, ny);
    setFocusKey(next);
    setSelected(next);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)?.focus();
  };

  return (
    <div className={styles.shell}>
      <div className={styles.grain} aria-hidden />

      <header className={styles.claimBar}>
        <div className={styles.claimText}>
          <p className={styles.kicker}>
            Stigmergy · <span>a CockroachDB agentic-memory demo</span>
          </p>
          <h1 className={styles.claim}>
            Eight robots share one warehouse. They never talk to each other. They coordinate by
            writing to a database.
          </h1>
        </div>

        <dl className={styles.counters}>
          <div className={styles.counter}>
            <dt>Messages between pickers</dt>
            <dd
              className={styles.zero}
              title="There is no code path in this repo that sends one. This is a constant, not a measurement."
            >
              0
            </dd>
          </div>
          <div className={styles.counter}>
            <dt>Database rows written</dt>
            <dd className={styles.big}>{(counts?.events ?? 0) + (counts?.scents ?? 0)}</dd>
          </div>
          <div className={styles.counter}>
            <dt>Claims lost to another picker</dt>
            <dd className={styles.big}>{(counts?.deadEnds ?? 0) + (counts?.jams ?? 0)}</dd>
          </div>
        </dl>

        <div className={styles.headerSide}>
          <p className={`${styles.conn} ${styles[`conn_${conn.tone}`]}`}>
            <i aria-hidden />
            {conn.label}
          </p>
          <Link href="/inspector">Who holds what →</Link>
        </div>
      </header>

      {conn.detail ? (
        <p
          className={conn.tone === "error" ? styles.bannerError : styles.bannerWarn}
          role="alert"
        >
          <strong>{conn.label}.</strong> {conn.detail}
        </p>
      ) : null}

      <p className={styles.liveStatus} role="status" aria-live="polite">
        {note ?? liveStatus}
      </p>

      <main className={styles.stage}>
        <div className={styles.floorWrap}>
          <div className={styles.floorHead}>
            <span className={styles.dockTag}>← Dock. Everything gets carried here.</span>
            <span className={styles.progress}>
              {onShelf} on the shelves · {carried} being carried · {delivered} delivered
            </span>
          </div>

          {!snap ? (
            <div className={styles.skeleton} role="status">
              Reading the floor out of the database…
            </div>
          ) : null}

          {snap && liveCount === 0 && !allDelivered ? (
            <div className={styles.empty} role="status">
              <p>
                The packages are already on the shelves. Nothing moves until you start the pickers.
                Watch <b>{CONTESTED_SKU}</b> — there is only one of it.
              </p>
            </div>
          ) : null}

          {allDelivered ? (
            <div className={styles.empty} role="status">
              <p>
                <b>All {total} packages delivered.</b> No supervisor scheduled any of that. Reset the
                floor to run it again.
              </p>
            </div>
          ) : null}

          <div className={styles.gridFrame}>
            <div className={styles.rulerTop} aria-hidden>
              {Array.from({ length: cols }, (_, x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            <div className={styles.rulerLeft} aria-hidden>
              {Array.from({ length: rows }, (_, y) => (
                <span key={y}>{y}</span>
              ))}
            </div>
            <div
              className={styles.grid}
              role="grid"
              ref={gridRef}
              onKeyDown={onGridKeyDown}
              aria-label="Warehouse floor. Each cell can be reserved by one picker at a time. Use arrow keys to move between cells."
              style={{
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`,
              }}
            >
              {Array.from({ length: rows * cols }, (_, i) => {
                const x = i % cols;
                const y = Math.floor(i / cols);
                const key = cellKey(x, y);
                const cell = cellMap.get(key);
                const pkg = pkgAt.get(key);
                const heat = scentHeat.get(key);
                const holder = cell?.reserved_by ?? null;
                const running = holder ? live.has(holder) : false;
                const stopped = Boolean(holder) && !running;
                const contested = pkg?.sku === CONTESTED_SKU && pkg.status === "waiting";

                const label = [
                  `Cell ${x},${y}`,
                  pkg ? `${pkg.label}, ${describePackageStatus(pkg)}` : null,
                  holder
                    ? running
                      ? `reserved by ${holder}, which is running`
                      : `reserved by ${holder}, whose loop is stopped. The reservation is still in the database.`
                    : "not reserved",
                  heat?.dead ? `${heat.dead} lost-package record${heat.dead > 1 ? "s" : ""} here` : null,
                ]
                  .filter(Boolean)
                  .join(". ");

                return (
                  <button
                    key={key}
                    type="button"
                    role="gridcell"
                    data-cell={key}
                    tabIndex={focusKey === key ? 0 : -1}
                    aria-label={label}
                    aria-selected={selected === key}
                    className={[
                      styles.cell,
                      holder ? styles.held : "",
                      running ? styles.running : "",
                      stopped ? styles.stopped : "",
                      pulse === key ? styles.pulse : "",
                      selected === key ? styles.picked : "",
                      x === 0 ? styles.dock : "",
                    ].join(" ")}
                    style={{
                      ["--dead" as string]: String(Math.min(1, (heat?.dead ?? 0) / 3)),
                      ["--trail" as string]: String(Math.min(1, (heat?.trail ?? 0) / 3)),
                      ["--jam" as string]: String(Math.min(1, (heat?.jam ?? 0) / 3)),
                    }}
                    onClick={() => {
                      setSelected(key);
                      setFocusKey(key);
                    }}
                  >
                    {running ? <i className={styles.bot} aria-hidden /> : null}
                    {stopped ? (
                      <span className={styles.lockTag}>
                        <i className={styles.padlock} aria-hidden />
                        LOCKED
                      </span>
                    ) : null}
                    {pkg ? (
                      // A cell is too small for a sentence. The SKU alone stays
                      // legible; scarcity is carried by colour here and stated in
                      // full in the panel and the conflict card.
                      <b className={contested ? styles.contested : styles.sku}>{pkg.sku}</b>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className={styles.rail}>
          <section className={styles.results} aria-labelledby="results-h">
            <h2 id="results-h">Evidence</h2>
            <p className={styles.railHint}>
              Every line here is a committed database row, not a message between pickers.
            </p>

            {olderRaces > 0 ? (
              <p className={styles.tally}>
                {olderRaces} earlier {olderRaces === 1 ? "race was" : "races were"} settled the same
                way. Every one is in Activity below.
              </p>
            ) : null}

            {cards.length === 0 ? (
              <p className={styles.placeholder}>
                Results from anything you do appear here and stay put.
              </p>
            ) : (
              <ul className={styles.cardList} tabIndex={0} aria-label="Evidence cards">
                {cards.map((card) => (
                  <li key={card.id} className={styles.card}>
                    {card.kind === "conflict" ? (
                      <ConflictCard
                        event={card.event}
                        showSql={showSql}
                        onFlash={flashCell}
                      />
                    ) : null}
                    {card.kind === "durability" ? (
                      <>
                        <h3>Stopped {card.stopped.length} picker loops</h3>
                        <p>
                          {card.stopped.join(", ") || "None were running"}. Their cell reservations
                          are still in the database — the cells marked <b>LOCKED</b> below. The
                          reservation outlived the worker that made it.
                        </p>
                        <p className={styles.cardNext}>
                          → Restart them and they read their position back out of the table.
                        </p>
                      </>
                    ) : null}
                    {card.kind === "resume" ? (
                      <>
                        <h3>Restarted {card.ids.length} pickers</h3>
                        <p>
                          {card.ids.join(", ") || "None"}. Nothing told them where they were. They
                          queried <code>cells</code> for their own id and carried on.
                        </p>
                      </>
                    ) : null}
                    {card.kind === "recall" ? (
                      <>
                        <h3>Past-failure recall turned {card.on ? "on" : "off"}</h3>
                        <p>
                          {card.on
                            ? "Pickers query the scents table for similar past failures again before choosing a move."
                            : "Pickers no longer query the scents table before choosing a move. Everything else is unchanged."}
                        </p>
                        <p className={styles.cardMetric}>
                          Failed claims in the last 30 seconds:{" "}
                          <b>{counts?.failedClaimsRecent ?? 0}</b>
                        </p>
                      </>
                    ) : null}
                    {card.kind === "note" ? (
                      <>
                        <h3>Nothing changed</h3>
                        <p>{card.message}</p>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className={styles.dismiss}
                      onClick={() => setCards((prev) => prev.filter((c) => c.id !== card.id))}
                    >
                      Dismiss
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selectedParts ? (
            <section className={styles.inspect} aria-live="polite" aria-labelledby="inspect-h">
              <h3 id="inspect-h">
                Cell {selectedParts.x},{selectedParts.y}
              </h3>
              <p>
                {selectedParts.cell?.reserved_by
                  ? selectedParts.running
                    ? `Reserved by ${selectedParts.cell.reserved_by}, which is running.`
                    : `Reserved by ${selectedParts.cell.reserved_by}, whose loop is stopped. The reservation is still in the database.`
                  : "Not reserved by anyone."}
              </p>
              <p>
                {selectedParts.pkg
                  ? `${selectedParts.pkg.label} — ${describePackageStatus(selectedParts.pkg)}.`
                  : "No package here."}
              </p>
              {selectedParts.scents.length > 0 ? (
                <ul className={styles.scentList}>
                  {selectedParts.scents.slice(0, 4).map((s) => (
                    <li key={s.id}>{describeScentKind(s.kind)}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section className={styles.activity} aria-labelledby="activity-h">
            <div className={styles.activityHead}>
              <h2 id="activity-h">Activity</h2>
              <div className={styles.toggles}>
                <button type="button" className={styles.textBtn} onClick={() => setShowEveryMove((v) => !v)}>
                  {showEveryMove ? "Decisions only" : "Show every move"}
                </button>
                <button type="button" className={styles.textBtn} onClick={toggleSql}>
                  {showSql ? "Hide SQL" : "Show the SQL"}
                </button>
              </div>
            </div>
            <ol className={styles.feed}>
              {visibleEvents.length === 0 ? (
                <li className={styles.placeholder}>
                  {liveCount === 0
                    ? "No writes yet. Starting the pickers fills this list."
                    : "No claims won or lost yet. Turn on “Show every move” to see the routine steps."}
                </li>
              ) : (
                visibleEvents.map((e) => {
                  const plain = describeEvent(e.event_type);
                  const subject = eventSubject(e);
                  return (
                    <li key={e.id} className={plain.weight === "decisive" ? styles.decisive : ""}>
                      <button type="button" onClick={() => flashCell(e.cell_x, e.cell_y)}>
                        <span className={styles.feedTop}>
                          <b>
                            {plain.title}
                            {subject ? <span className={styles.subject}> {subject}</span> : null}
                          </b>
                          <em>
                            {e.picker_id ?? "system"} · {formatClock(e.at)}
                          </em>
                        </span>
                        <small>{plain.why}</small>
                        {showSql && e.sql_text ? <code>{e.sql_text}</code> : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ol>
          </section>
        </aside>
      </main>

      <footer className={styles.strip}>
        <div className={styles.actions}>
          <Action
            primary
            label={`Start ${DEFAULT_SPAWN} pickers`}
            sub="Each picks its own moves. Nothing assigns them work."
            disabled={busy}
            onClick={() => void act("spawn", { count: DEFAULT_SPAWN })}
          />
          <Action
            label="Cause a conflict"
            sub={`Puts one ${CONTESTED_SKU} on a shelf with a picker either side. Neither is told to want it.`}
            disabled={busy}
            onClick={() => void act("conflict")}
          />
          <Action
            label="Stop the picker loops"
            sub={
              liveCount === 0 ? "Nothing is running." : "Stops half of them. The reservations stay."
            }
            disabled={busy || liveCount === 0}
            onClick={() => void act("killHalf")}
          />
          <Action
            label={`Restart ${stoppedHolders.length || ""} stopped pickers`.replace("  ", " ")}
            sub={
              stoppedHolders.length === 0
                ? "Nothing is stopped yet."
                : "Same ids. They read their position out of the table."
            }
            disabled={busy || stoppedHolders.length === 0}
            onClick={() => void act("respawn", { ids: stoppedHolders })}
          />
          <Action
            label={recallOn ? "Turn memory off" : "Turn memory back on"}
            sub={
              recallOn
                ? "Stops pickers reading past failures, so you can see whether it matters."
                : "Pickers are ignoring past failures right now."
            }
            disabled={busy}
            onClick={() => void act("recall", { on: !recallOn })}
          />
          <Action
            label={confirmReset ? "Confirm reset" : "Reset the floor"}
            sub="Deletes every reservation, record and event, then puts the packages back."
            disabled={busy}
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              setConfirmReset(false);
              void act("reset");
            }}
          />
        </div>

        <ul className={styles.legend}>
          <li>
            <i className={styles.swatchRunning} aria-hidden /> Picker running here
          </li>
          <li>
            <i className={styles.swatchStopped} aria-hidden /> Reservation held, loop stopped
          </li>
          <li>
            <i className={styles.swatchDead} aria-hidden /> A picker lost a package here
          </li>
          <li>
            <i className={styles.swatchJam} aria-hidden /> A picker lost this cell
          </li>
          <li>
            <i className={styles.swatchTrail} aria-hidden /> A delivery came through
          </li>
        </ul>
      </footer>
    </div>
  );
}

function Action(props: {
  label: string;
  sub: string;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={props.primary ? styles.primaryAction : styles.action}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <b>{props.label}</b>
      <small>{props.sub}</small>
    </button>
  );
}

function ConflictCard(props: {
  event: FloorEvent;
  showSql: boolean;
  onFlash: (x: number | null, y: number | null) => void;
}) {
  const f = conflictFacts(props.event);
  return (
    <>
      <h3>Two pickers wanted the same {f.label ?? "package"}</h3>
      <p>
        <button
          type="button"
          className={styles.inlineLink}
          onClick={() => props.onFlash(f.cell[0], f.cell[1])}
        >
          Cell {f.cell[0]},{f.cell[1]}
        </button>
        {f.winner ? (
          <>
            {" — "}
            <b>{f.winner}</b> won it. <b>{f.loser}</b> lost.
          </>
        ) : (
          <>
            {" — "}
            <b>{f.loser}</b> lost the claim.
          </>
        )}
      </p>
      <p>
        The losing picker sent no message. It wrote one row into{" "}
        <code className={styles.inlineCode}>scents</code>
        {f.reason ? (
          <>
            : <q>{f.reason}</q>
          </>
        ) : (
          "."
        )}
      </p>
      <p className={styles.cardNext}>
        → Other pickers query that row before choosing a move, so they route around this cell.
      </p>
      {props.showSql && props.event.sql_text ? <code>{props.event.sql_text}</code> : null}
    </>
  );
}
