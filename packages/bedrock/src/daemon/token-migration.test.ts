import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { applyMigrations } from "../db";
import { openDaemonDatabase, tokenHash } from "./db";

test("existing deploy tokens retain full access and creator ownership is backfilled on upgrade", async () => {
  const temp = tempDirectory();
  try {
    const migrations = join(temp.dir, "old-migrations");
    for (const name of ["0000_daemon.sql", "0001_auth.sql", "0002_token_email.sql"]) await Bun.write(join(migrations, name), await Bun.file(join(import.meta.dir, "migrations", name)).text());
    const old = new Database(join(temp.dir, "bedrock.sqlite"), { create: true });
    await applyMigrations(old, migrations);
    old.query("INSERT INTO users VALUES (?, ?, ?, ?, ?)").run("creator", "creator@example.test", "Creator", null, Date.now());
    old.query("INSERT INTO deploy_tokens (hash, created_at, email) VALUES (?, ?, ?)").run(tokenHash("legacy"), Date.now(), "creator@example.test");
    old.query("INSERT INTO deploy_tokens (hash, created_at, email) VALUES (?, ?, ?)").run(tokenHash("manual"), Date.now(), null);
    old.close();
    const upgraded = await openDaemonDatabase(temp.dir);
    expect(upgraded.accepts("legacy")).toBe(true); expect(upgraded.tokenScope("legacy")).toBeNull();
    expect(upgraded.tokenOwner("legacy")).toMatchObject({ id: "creator" }); expect(upgraded.tokenOwner("manual")).toBeNull();
    const raw = upgraded.createToken("creator@example.test", { name: "scoped", scope: { pebbles: ["bot-*"], actions: ["deploy"] } });
    upgraded.close();
    const reopened = await openDaemonDatabase(temp.dir);
    expect(reopened.tokenScope(raw)).toEqual({ pebbles: ["bot-*"], actions: ["deploy"] });
    expect(reopened.tokenOwner(raw)).toMatchObject({ id: "creator" }); reopened.close();
  } finally { temp.cleanup(); }
});
