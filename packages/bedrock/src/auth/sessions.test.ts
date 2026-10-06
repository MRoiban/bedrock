import { expect, test } from "bun:test";
import { openDaemonDatabase, tokenHash } from "../daemon/db";
import { tempDirectory } from "../../test/helpers";
import { createSessions, DAY, SESSION_LIFETIME } from "./sessions";

test("sessions hash random tokens, slide once per day, expire, and revoke", async () => {
  const temp = tempDirectory();
  const db = await openDaemonDatabase(temp.dir);
  let now = 1_000_000;
  const sessions = createSessions(db.db, () => now);
  try {
    const user = sessions.user("Alice@Example.test", "Alice");
    expect(sessions.user("alice@example.test", "Alice").id).toBe(user.id);
    const token = sessions.create(user.id);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(db.db.query("SELECT id_hash FROM sessions").get()).toEqual({ id_hash: tokenHash(token) });
    expect(sessions.resolve(token)?.refreshed).toBe(false);
    now += DAY - 1;
    expect(sessions.resolve(token)?.refreshed).toBe(false);
    now++;
    expect(sessions.resolve(token)).toMatchObject({ refreshed: true, expiresAt: now + SESSION_LIFETIME });
    expect(sessions.resolve(token)?.refreshed).toBe(false);
    now += SESSION_LIFETIME;
    expect(sessions.resolve(token)).toBeNull();
    expect(sessions.resolve("invalid")).toBeNull();
    const next = sessions.create(user.id);
    sessions.revoke(tokenHash(next));
    expect(sessions.resolve(next)).toBeNull();
    expect(sessions.create(user.id)).not.toBe(next);
  } finally { db.close(); temp.cleanup(); }
});
