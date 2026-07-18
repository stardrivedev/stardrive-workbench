/**
 * Server-only generic data layer, backed by libSQL: a real Turso database in
 * production (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN), or a local embedded
 * SQLite file in dev when those are unset — same code path either way.
 * Each collection is one JSON blob in the `collections` table, keyed by
 * name. Content modules build their typed accessors on top of this.
 */
import { createClient } from "@libsql/client";
import { existsSync, mkdirSync } from "fs";
import path from "path";

function localDbUrl(): string {
  const dir = path.join(process.cwd(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return `file:${path.join(dir, "cms.db")}`;
}

const client = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: localDbUrl() }
);

let ready: Promise<unknown> | null = null;
function ensureTable() {
  if (!ready) {
    ready = client.execute(
      "CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, data TEXT NOT NULL)"
    );
  }
  return ready;
}

export async function readCollection<T>(name: string, fallback: T): Promise<T> {
  try {
    await ensureTable();
    const res = await client.execute({
      sql: "SELECT data FROM collections WHERE name = ?",
      args: [name],
    });
    const row = res.rows[0];
    if (!row) return fallback;
    return JSON.parse(row.data as string) as T;
  } catch {
    return fallback;
  }
}

export async function writeCollection<T>(name: string, data: T): Promise<void> {
  await ensureTable();
  await client.execute({
    sql: "INSERT INTO collections (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data",
    args: [name, JSON.stringify(data)],
  });
}
