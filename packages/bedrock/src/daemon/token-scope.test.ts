import { expect, test } from "bun:test";
import { authorizeScope, matchesPebble, validateTokenScope } from "./token-scope";

test("scope validation and per-action denial default to refusing unmatched endpoints", () => {
  for (const value of [{}, { pebbles: [], actions: ["deploy"] }, { pebbles: ["../evil"], actions: ["deploy"] }, { pebbles: ["*"], actions: ["backup"] }]) expect(() => validateTokenScope(value)).toThrow();
  const scope = validateTokenScope({ pebbles: ["bot-*", "upty"], actions: ["secrets"] })!;
  expect(matchesPebble(scope, "bot-one")).toBe(true); expect(matchesPebble(scope, "evilbot-one")).toBe(false);
  authorizeScope(scope, new Request("http://localhost/api/pebbles/upty/secrets"));
  for (const path of ["/api/pebbles/upty/logs", "/api/pebbles/upty/restart", "/api/pebbles/other/secrets", "/api/status", "/api/config", "/api/pebbles/upty/secrets/extra"])
    expect(() => authorizeScope(scope, new Request(`http://localhost${path}`, { method: path.endsWith("restart") ? "POST" : "GET" }))).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  authorizeScope(null, new Request("http://localhost/api/config"));
});
