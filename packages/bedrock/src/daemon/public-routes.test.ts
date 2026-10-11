import { expect, test } from "bun:test";
import { matchesPublicRoute } from "./public-routes";

test("public route matching is method-specific and segment-exact on normalized paths", () => {
  const keys = ["GET /doc", "GET /files/:id"];
  for (const [method, path] of [["GET", "/doc"], ["HEAD", "/doc"], ["GET", "/files/abc"], ["GET", "/files/secret"]])
    expect(matchesPublicRoute(keys, method!, path!)).toBe(true);
  for (const path of ["/doc/", "//doc", "/DOC", "/x/../private", "/%70rivate", "/doc%2F..%2Fprivate", "/files/a/b", "/files/", "/%64oc"])
    expect(matchesPublicRoute(keys, "GET", new URL(`http://localhost${path}`).pathname)).toBe(false);
  expect(matchesPublicRoute(["GET /:a/:b"], "GET", "/_bedrock/health")).toBe(false);
  expect(matchesPublicRoute(keys, "POST", "/doc")).toBe(false);
  expect(matchesPublicRoute(keys, "get", "/doc")).toBe(false);
});
