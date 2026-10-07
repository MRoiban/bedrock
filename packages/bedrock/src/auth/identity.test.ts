import { expect, test } from "bun:test";
import { deriveIdentitySecret, signIdentity, verifyIdentity } from "./identity";
import type { User } from "../config";

const user = { id: "alice", email: "alice@example.test", name: "Alice", avatarUrl: "https://example.test/avatar" };
test("signed identity accepts only fresh authentic headers", () => {
  const headers = signIdentity(user, "secret", 100_000);
  const request = (value: HeadersInit = headers) => new Request("http://localhost", { headers: value });
  expect(verifyIdentity(request(), "secret", 160_000)).toEqual(user);
  expect(verifyIdentity(request({}), "secret")).toBeNull();
  expect(() => verifyIdentity(request(), "secret", 160_001)).toThrow();
  expect(() => verifyIdentity(request(), "secret", 99_999)).toThrow();
  expect(() => verifyIdentity(request(), "wrong", 100_000)).toThrow();
  expect(() => verifyIdentity(request(), undefined, 100_000)).toThrow();
  for (const name of Object.keys(headers)) {
    const incomplete = new Headers(headers); incomplete.delete(name);
    expect(() => verifyIdentity(request(incomplete), "secret", 100_000)).toThrow();
  }
  expect(() => verifyIdentity(request({ ...headers, "x-bedrock-signature": "00".repeat(32) }), "secret", 100_000)).toThrow();
  expect(() => verifyIdentity(request({ ...headers, "x-bedrock-user": JSON.stringify({ ...user, id: "bob" }) }), "secret", 100_000)).toThrow();
});

test("per-pebble identity secrets reject sibling signatures and change each boot", () => {
  const aliceSecret = deriveIdentitySecret("boot-master", "pebble-a");
  const bobSecret = deriveIdentitySecret("boot-master", "pebble-b");
  expect(aliceSecret).toHaveLength(64);
  expect(aliceSecret).not.toBe(bobSecret);
  expect(aliceSecret).toBe(deriveIdentitySecret("boot-master", "pebble-a"));
  expect(aliceSecret).not.toBe(deriveIdentitySecret("next-boot", "pebble-a"));
  const forged = new Request("http://127.0.0.1", { headers: signIdentity(user, aliceSecret) });
  expect(verifyIdentity(forged, aliceSecret)).toEqual(user);
  expect(() => verifyIdentity(forged, bobSecret)).toThrow();
});

test("identity headers stay ASCII and survive a real WebSocket upgrade", async () => {
  const secret = "s".repeat(64);
  const user = { id: "u1", email: "lea@example.com", name: "Léa Ünal 🌱" } as User;
  const headers = signIdentity(user, secret);
  expect(/^[\x20-\x7e]*$/.test(headers["x-bedrock-user"])).toBe(true);
  let seen = null as User | null;
  const server = Bun.serve({ port: 0, fetch(request, server) { seen = verifyIdentity(request, secret); return server.upgrade(request) ? undefined : new Response("no", { status: 400 }); }, websocket: { message() {} } });
  try {
    const Socket = WebSocket as unknown as new (url: string, options: Bun.WebSocketOptions) => WebSocket;
    const socket = new Socket(`ws://127.0.0.1:${server.port}/`, { headers });
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.close();
    expect(seen).toEqual(user);
  } finally { server.stop(true); }
});
