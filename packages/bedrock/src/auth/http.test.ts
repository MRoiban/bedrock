import { expect, test } from "bun:test";
import { validateReturn, cookieToken, requireOrigin, sessionCookie } from "./http";
import { proxyHeaders } from "../daemon/proxy";
import { enforceAccess } from "./policy";

const user = { id: "a", email: "Alice@company.test", name: "Alice" };
test("return URLs cannot escape the configured domain", () => {
  expect(validateReturn("https://notes.example.test/a?q=1", "example.test")).toBe("https://notes.example.test/a?q=1");
  for (const url of ["/relative", "http://notes.example.test", "https://example.test", "https://evil-example.test", "https://notes.example.test.evil.test", "https://user@notes.example.test", "https://nested.notes.example.test", "https://notes.example.test:123", "javascript:alert(1)"]) expect(() => validateReturn(url, "example.test")).toThrow();
  expect(validateReturn("http://notes.localhost:3000", "localhost", true)).toBe("http://notes.localhost:3000/");
});
test("proxy strips every session cookie and identity header, preserving other cookies", () => {
  const request = new Request("http://notes.localhost", { headers: { cookie: "theme=dark; bedrock_session=secret; other=value; bedrock_session=evil", "x-bedrock-user": "spoofed" } });
  expect(proxyHeaders(request).get("cookie")).toBe("theme=dark; other=value");
  expect(proxyHeaders(request).get("x-bedrock-user")).toBeNull();
  expect(cookieToken(request)).toBeNull();
  expect(sessionCookie("token", "example.test", false, 0)).toContain("Domain=.example.test; Secure");
  expect(sessionCookie("token", "localhost", true, 0)).not.toContain("Domain=");
});
test("write and WebSocket origins must exactly match, including scheme and port", () => {
  const origin = "http://notes.localhost:3000";
  requireOrigin(new Request(origin, { headers: { origin } }), origin);
  for (const value of ["http://other.localhost:3000", "http://notes.localhost", "https://notes.localhost:3000", "null", ""]) expect(() => requireOrigin(new Request(origin, { headers: { origin: value } }), origin)).toThrow();
});
test("all access modes enforce identity, creator emails and allow domains", () => {
  enforceAccess("public", null);
  enforceAccess("users", user);
  enforceAccess("creators", user, ["alice@company.test"]);
  enforceAccess({ allow: ["@company.test"] }, user);
  enforceAccess({ allow: ["alice@company.test"] }, user);
  for (const access of ["users", "creators", { allow: ["@company.test"] }] as const) expect(() => enforceAccess(access, null)).toThrow();
  expect(() => enforceAccess("creators", user, ["bob@company.test"])).toThrow();
  expect(() => enforceAccess({ allow: ["@other.test"] }, user)).toThrow();
  expect(() => enforceAccess({ allow: ["@company.test"] }, { ...user, email: "a@evilcompany.test" })).toThrow();
});
