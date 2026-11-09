import { join } from "node:path";
import { openDatabase, applyMigrations } from "../db";
import { openDaemonDatabase } from "../daemon/db";
import { loadPebble } from "../runtime/load";
import { fixtureDate, fixtureUsers, loadTestConfig } from "./config";

export async function createTemplate(dir: string, home: string, list = false) {
  const config = await loadTestConfig(dir);
  const pebble = await loadPebble(dir);
  const users = fixtureUsers(config);
  const anonymous = !pebble.access || pebble.access === "public";
  const manifest = { pages: config.pages ?? (pebble.web ? [...(anonymous ? [{ path: "/", user: "anonymous" }] : []), { path: "/", user: "owner" }] : []), anonymousRoot: anonymous || config.pages !== undefined ? "configured" : "protected", users, name: pebble.name, seed: config.seed ? "configured" : "none", date: fixtureDate };
  if (list) return manifest;
  await Bun.write(join(home, "config.json"), JSON.stringify({ domain: "localhost", creators: [users.owner.email], port: 0 }));
  const identity = await openDaemonDatabase(home);
  try {
    for (const user of Object.values(users)) identity.db.query("INSERT INTO users (id,email,name,avatar_url,created_at) VALUES (?,?,?,NULL,?)").run(user.id, user.email, user.name, Date.parse(fixtureDate));
  } finally { identity.close(); }
  const dataDir = join(home, "data");
  const database = openDatabase(dataDir, pebble.schema, !!pebble.tokens);
  try {
    await applyMigrations(database.sqlite, join(dir, "migrations"));
    await config.seed?.({ db: database.db, sqlite: database.sqlite, dataDir, users, now: new Date(fixtureDate) });
    database.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally { await database.closeAsync(); }
  return manifest;
}
