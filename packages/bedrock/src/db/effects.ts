import type { Database } from "bun:sqlite";
import { TableTracker, sqlTokens } from "./tracker";

// SQLite executes cascades and triggers without calling the Drizzle logger.
export function writeEffects(sqlite: Database): Map<string, Set<string>> {
  const tables = sqlite.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const effects = new Map(tables.map(({ name }) => [name, new Set<string>()]));
  const canonical = new Map(tables.map(({ name }) => [name.toLowerCase(), name]));
  for (const { name } of tables) {
    const keys = sqlite.query(`PRAGMA foreign_key_list("${name.replaceAll('"', '""')}")`).all() as { table: string; on_delete: string; on_update: string }[];
    for (const key of keys) {
      if ([key.on_delete, key.on_update].some(action => ["CASCADE", "SET NULL", "SET DEFAULT"].includes(action))) {
        const parent = canonical.get(key.table.toLowerCase());
        if (parent) effects.get(parent)!.add(name);
      }
    }
  }
  const tracker = new TableTracker(tables.map(t => t.name));
  const triggers = sqlite.query("SELECT tbl_name, sql FROM sqlite_master WHERE type='trigger'").all() as { tbl_name: string; sql: string }[];
  for (const trigger of triggers) {
    const tokens = sqlTokens(trigger.sql);
    const begin = tokens.findIndex(token => token.toLowerCase() === "begin");
    const usage = tracker.inspect(tokens.slice(begin + 1));
    for (const target of usage.writes) effects.get(trigger.tbl_name)?.add(target);
  }
  return effects;
}
