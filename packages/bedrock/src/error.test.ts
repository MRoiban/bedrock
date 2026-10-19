import { expect, spyOn, test } from "bun:test";
import { BedrockError, asBedrockError, errorStatus } from "./error";
import { errorResponse } from "./runtime/http";

const status = (code: string, explicit?: number) => errorStatus(new BedrockError(code, "Failed.", "Retry.", undefined, { status: explicit }));

test("explicit status wins only when it is an integer from 400 to 599", () => {
  expect(status("TIME_CONFLICT", 418)).toBe(418);
  expect(status("FUNCTION_NOT_FOUND", 410)).toBe(410);
  expect(status("CUSTOM_FAILURE", 599)).toBe(599);
  for (const ignored of [200, 399, 600, 404.5, Number.NaN]) expect(status("CUSTOM_FAILURE", ignored)).toBe(400);
});

test("Bedrock's code table keeps old entries and adds server faults", () => {
  const table: Record<string, number> = {
    FUNCTION_NOT_FOUND: 404, UPLOAD_NOT_FOUND: 404, UNAUTHENTICATED: 401, FORBIDDEN: 403, INVALID_IDENTITY: 403,
    FILE_TOO_LARGE: 413, QUOTA_EXCEEDED: 400, FILE_TYPE_REJECTED: 400, UPLOAD_CHECKSUM_MISMATCH: 400,
    PEBBLE_STOPPED: 503, LOGIN_LIMIT: 429, READ_ONLY: 500, UNKNOWN_TABLE: 500, DETACHED_CONTEXT: 500,
    OAUTH_NOT_CONFIGURED: 500, UNKNOWN_BUCKET: 500, TOKENS_DISABLED: 500,
  };
  for (const [code, expected] of Object.entries(table)) expect([code, status(code)]).toEqual([code, expected]);
});

test("conventions map pebble codes, other deliberate errors are 400", () => {
  const conventions: Record<string, number> = {
    NOT_FOUND: 404, EVENT_NOT_FOUND: 404, CONFLICT: 409, TIME_CONFLICT: 409, RATE_LIMITED: 429,
    INVALID_STATE: 400, OOPS: 400, NOT_FOUND_YET: 400, TOO_RATE_LIMITED: 400, toString: 400,
  };
  for (const [code, expected] of Object.entries(conventions)) expect([code, status(code)]).toEqual([code, expected]);
});

test("wrapped non-Bedrock throws are 500 unless a status rule names the code", () => {
  expect(errorStatus(asBedrockError(new Error("boom")))).toBe(500);
  expect(errorStatus(asBedrockError("boom", "FUNCTION_FAILED"))).toBe(500);
  expect(errorStatus(asBedrockError(new SyntaxError("bad"), "INVALID_ARGS"))).toBe(400);
  expect(errorStatus(asBedrockError(new Error("gone"), "UPLOAD_NOT_FOUND"))).toBe(404);
  expect(errorStatus(new BedrockError("FUNCTION_FAILED", "Deliberate.", "Retry."))).toBe(400);
  const deliberate = new BedrockError("OOPS", "Deliberate.", "Retry.");
  expect(asBedrockError(deliberate)).toBe(deliberate);
  expect(errorStatus(asBedrockError(deliberate))).toBe(400);
});

test("data is serialized when present and dropped with a warning when it cannot be", async () => {
  const plain = new BedrockError("TIME_CONFLICT", "Ambiguous.", "Choose.");
  expect(plain.toJSON()).toEqual({ code: "TIME_CONFLICT", message: "Ambiguous.", hint: "Choose." });
  expect(Object.hasOwn(plain, "data") || Object.hasOwn(plain, "status")).toBe(false);
  const data = { candidates: ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"], at: new Date(0) };
  expect(new BedrockError("TIME_CONFLICT", "Ambiguous.", "Choose.", "detail", { data }).toJSON())
    .toEqual({ code: "TIME_CONFLICT", message: "Ambiguous.", hint: "Choose.", detail: "detail", data: { candidates: data.candidates, at: "1970-01-01T00:00:00.000Z" } });
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const bad of [1n, cyclic, () => {}]) {
      const response = errorResponse(new BedrockError("TIME_CONFLICT", "Ambiguous.", "Choose.", undefined, { data: bad }));
      expect(response.status).toBe(409);
      expect((await response.json()).error).toEqual({ code: "TIME_CONFLICT", message: "Ambiguous.", hint: "Choose." });
    }
    expect(warn).toHaveBeenCalledTimes(2);
  } finally { warn.mockRestore(); }
});
