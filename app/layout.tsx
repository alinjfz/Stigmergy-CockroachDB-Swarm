import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stigmergy — the table is the swarm",
  description:
    "Warehouse pickers that never message each other. They write scents into CockroachDB. The heatmap of the table is the swarm.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Red+Hat+Mono:wght@400;500;700&family=Tektur:wght@500;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
