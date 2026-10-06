import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { connection } from "./daemon";

const remote = { url: "https://bedrock.example.com", token: `br_${"a".repeat(64)}` };
test("connection falls back to saved remote credentials only when local daemon is unavailable", async () => {
  const temp = tempDirectory();
  const options = { home: temp.dir, credentials: async () => remote };
  try {
    expect(await connection({}, options)).toEqual(remote);
    await Bun.write(join(temp.dir, "daemon.json"), JSON.stringify({ port: 3000 }));
    await Bun.write(join(temp.dir, "admin-token"), "local-token");
    const reachable = (async () => Response.json({ ok: true })) as unknown as typeof fetch;
    expect(await connection({}, { ...options, fetch: reachable })).toEqual({ url: "http://bedrock.localhost:3000", token: "local-token" });
    const unreachable = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await connection({}, { ...options, fetch: unreachable })).toEqual(remote);
    const unauthorized = (async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
    expect((await connection({}, { ...options, fetch: unauthorized })).token).toBe("local-token");
    expect(await connection({ "--url": remote.url }, options)).toEqual(remote);
    await expect(connection({ "--url": "https://bedrock.other.com" }, options)).rejects.toMatchObject({ code: "TOKEN_MISSING" });
    expect(await connection({ "--url": "https://bedrock.other.com", "--token": "explicit" }, options)).toMatchObject({ token: "explicit" });
  } finally { temp.cleanup(); }
});
