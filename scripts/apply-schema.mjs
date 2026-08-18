import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvFile(resolve(".env.local"));
loadEnvFile(resolve(".env"));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = readFileSync(resolve("sql/schema.sql"), "utf8");
const pool = new pg.Pool({
  connectionString: url,
  ssl: url.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false },
});

const client = await pool.connect();
try {
  await client.query(sql);
  console.log("schema applied");
} finally {
  client.release();
  await pool.end();
}
