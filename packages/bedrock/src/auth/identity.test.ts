import { expect, test } from "bun:test";
import { signIdentity, verifyIdentity } from "./identity";

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
