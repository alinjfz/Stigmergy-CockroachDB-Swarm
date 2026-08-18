"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./inspector.module.css";

type Inspector = {
  readOnly: boolean;
  note: string;
  insulin: {
    id: string;
    status: string;
    claimed_by: string | null;
    cell: number[];
  } | null;
  holdings: { picker: string | null; cell: number[]; package: string | null }[];
  lastEvents: { at: string; picker_id: string | null; event_type: string; sql_text: string | null }[];
};

export default function InspectorPage() {
  const [data, setData] = useState<Inspector | null>(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/inspector", { cache: "no-store" });
      setData((await res.json()) as Inspector);
    };
    void load();
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className={styles.page}>
      <p className={styles.kicker}>MCP analogue · read-only</p>
      <h1 className={styles.title}>Who holds the floor</h1>
      <p className={styles.note}>{data?.note}</p>
      <section>
        <h2>INSULIN</h2>
        <pre className={styles.dump}>{JSON.stringify(data?.insulin, null, 2)}</pre>
      </section>
      <section>
        <h2>Reservations</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>picker</th>
              <th className={styles.th}>cell</th>
              <th className={styles.th}>sku</th>
            </tr>
          </thead>
          <tbody>
            {(data?.holdings ?? []).map((h, i) => (
              <tr key={i}>
                <td className={styles.td}>{h.picker}</td>
                <td className={styles.td}>
                  {h.cell[0]},{h.cell[1]}
                </td>
                <td className={styles.td}>{h.package ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p>
        <Link href="/">← floor</Link>
      </p>
    </main>
  );
}
