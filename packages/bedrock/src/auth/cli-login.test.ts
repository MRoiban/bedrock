import { expect, test } from "bun:test";
import { openDaemonDatabase } from "../daemon/db";
import { tempDirectory } from "../../test/helpers";
import { createSessions } from "./sessions";
import { createCliLogin } from "./cli-login";

test("CLI authorization permits form redirects to dynamic loopback ports", async () => {
  const temp = tempDirectory();
  const db = await openDaemonDatabase(temp.dir);
  try {
    const sessions = createSessions(db.db);
    const email = "creator@example.test";
    const token = sessions.create(sessions.user(email, "Creator").id);
    const login = createCliLogin({ domain: "example.test", creators: [email], port: 0 }, sessions, db);
    const origin = "https://bedrock.example.test";
    const page = await login(new Request(`${origin}/cli-login?port=43210&state=${"a".repeat(64)}`, {
      headers: { cookie: `bedrock_session=${token}` },
    }), origin);
    expect(page.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'");
  } finally { db.close(); temp.cleanup(); }
});
