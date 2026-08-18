"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./inspector.module.css";

type Holding = { picker: string | null; cell: number[]; package: string | null };

type Inspector = {
  readOnly: boolean;
  note: string;
  sku: string;
  store: string;
  contested: {
    id: string;
    sku: string;
    status: string;
    claimed_by: string | null;
    cell: number[];
  } | null;
  holdings: Holding[];
};

type Denial = { attempted: string; message: string };

export default function InspectorPage() {
  const [data, setData] = useState<Inspector | null>(null);
  const [failed, setFailed] = useState(false);
  const [denial, setDenial] = useState<Denial | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inspector", { cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setData((await res.json()) as Inspector);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, [load]);

  const tryRelease = async (h: Holding) => {
    try {
      const res = await fetch("/api/inspector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cell: h.cell, picker: h.picker }),
      });
      const json = (await res.json()) as Denial;
      setDenial(json);
    } catch {
      setDenial({
        attempted: "—",
        message: "The request never completed. Either way, nothing was released.",
      });
    }
  };

  const sku = data?.sku ?? "the last unit";

  const contestedLine = (() => {
    if (!data) return null;
    if (!data.contested) return `${sku} is not on this floor.`;
    if (data.contested.claimed_by) {
      return `${data.contested.claimed_by} holds ${sku}, picked up at cell ${data.contested.cell.join(",")}.`;
    }
    return `${sku} is still on the shelf at cell ${data.contested.cell.join(",")}. Nobody has won the claim yet.`;
  })();

  return (
    <main className={styles.page}>
      <p className={styles.kicker}>Read-only view · the same answers Cockroach MCP gives</p>
      <h1 className={styles.title}>Who holds what</h1>
      <p className={styles.lede}>
        You can read every reservation on the floor from here. You cannot take one. Try it below —
        the boundary is a missing write path, not a politely worded instruction.
      </p>

      {failed ? (
        <p className={styles.error} role="alert">
          <strong>Cannot reach the floor.</strong> Nothing below is live.
        </p>
      ) : null}

      {data?.store === "memory" ? (
        <p className={styles.warn} role="alert">
          <strong>Not connected to CockroachDB.</strong> This is temporary in-app memory, so these
          rows do not survive a restart.
        </p>
      ) : null}

      <section>
        <h2>The contested unit</h2>
        {!data && !failed ? (
          <p className={styles.note}>Reading the packages table…</p>
        ) : (
          <p className={styles.answer}>{contestedLine}</p>
        )}
      </section>

      <section>
        <h2>Reservations right now</h2>
        {!data && !failed ? (
          <p className={styles.note}>Reading the cells table…</p>
        ) : (data?.holdings ?? []).length === 0 ? (
          <p className={styles.note}>
            No cells are reserved. <Link href="/">Start the pickers on the floor</Link> first.
          </p>
        ) : (
          <table className={styles.table}>
            <caption className={styles.caption}>
              {data?.holdings.length} reservations, read from the cells table.
            </caption>
            <thead>
              <tr>
                <th className={styles.th} scope="col">
                  Picker
                </th>
                <th className={styles.th} scope="col">
                  Cell
                </th>
                <th className={styles.th} scope="col">
                  Package on that cell
                </th>
                <th className={styles.th} scope="col">
                  Try to take it
                </th>
              </tr>
            </thead>
            <tbody>
              {(data?.holdings ?? []).map((h) => (
                <tr key={`${h.cell[0]},${h.cell[1]}`}>
                  <td className={styles.td}>{h.picker}</td>
                  <td className={styles.td}>
                    {h.cell[0]},{h.cell[1]}
                  </td>
                  <td className={styles.td}>{h.package ?? "—"}</td>
                  <td className={styles.td}>
                    <button
                      type="button"
                      className={styles.attempt}
                      onClick={() => void tryRelease(h)}
                    >
                      Release it
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {denial ? (
        <section className={styles.denial} role="status" aria-live="polite">
          <h2>Refused</h2>
          <code>{denial.attempted}</code>
          <p>{denial.message}</p>
          <p className={styles.note}>
            Cockroach Cloud Managed MCP refuses the same write at the credential level, so a judge
            asking questions in Cursor cannot change the floor either.
          </p>
          <button type="button" className={styles.attempt} onClick={() => setDenial(null)}>
            Dismiss
          </button>
        </section>
      ) : null}

      <p className={styles.back}>
        <Link href="/">← Back to the floor</Link>
      </p>
    </main>
  );
}
