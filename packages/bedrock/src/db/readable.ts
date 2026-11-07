import type { Database } from "bun:sqlite";

export function databaseReadable(sqlite: Database, table: "sqlite_schema" | "pebbles") {
  let timeout: number | undefined;
  try {
    timeout = (sqlite.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout;
    // Diagnostic reads must never inherit the application's five-second lock wait.
    sqlite.exec("PRAGMA busy_timeout=0");
    sqlite.query(`SELECT 1 FROM ${table} LIMIT 1`).all();
    return true;
  } catch { return false; }
  finally { if (timeout !== undefined) try { sqlite.exec(`PRAGMA busy_timeout=${timeout}`); } catch {} }
}
