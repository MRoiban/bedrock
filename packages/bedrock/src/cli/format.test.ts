import { describe, expect, spyOn, test } from "bun:test";
import { formatResult } from "./format";

const options = { color: false };
const stamp = "2026-01-01T00:00:00.000Z";
const at = Date.parse(stamp);
const issue = { id: "e1", state: "open", runtime: "server", type: "TypeError", last_seen: at };
const manifest = { timestamp: stamp, version: "v1", db: "notes/db/one.sqlite.gz", files: { a: "hash" } };
const fixtures: [string, unknown, string][] = [
  ["ls", [{ name: "notes", status: "running", pid: 42, memory: { resident: 1024 }, public_routes: ["/health"] }], "NAME   STATUS   PID  MEMORY   PUBLIC ROUTES  SOURCE\nnotes  running  42   1.0 KiB  /health        unknown source"],
  ["token ls", [{ id: "abc", name: "bot", createdAt: at, scope: null }], "ID   NAME  CREATED                   PEBBLES  ACTIONS\nabc  bot   2026-01-01T00:00:00.000Z  *        all"],
  ["secrets ls", { secrets: [{ name: "KEY", updatedAt: at }] }, "NAME  UPDATED\nKEY   2026-01-01T00:00:00.000Z"],
  ["jobs ls", [{ name: "sweep", cron: "0 * * * *", running: false }], "JOB    CRON       STATUS\nsweep  0 * * * *  idle"],
  ["jobs history", [{ job: "sweep", state: "succeeded", at, run: "r1" }], "JOB    STATE      TIME                      RUN\nsweep  succeeded  2026-01-01T00:00:00.000Z  r1"],
  ["backup ls", [manifest], "TIMESTAMP                 VERSION  FILES  DATABASE\n2026-01-01T00:00:00.000Z  v1       1      notes/db/one.sqlite.gz"],
  ["errors list", { issues: [issue] }, "ISSUE  STATE  RUNTIME  TYPE       LAST SEEN\ne1     open   server   TypeError  2026-01-01T00:00:00.000Z"],
  ["errors show", { issues: [issue], samples: [{ message: "Oops", frames: [{ function: "save", file: "pebble.ts", line: 2, column: 3 }] }] }, "ISSUE  STATE  RUNTIME  TYPE       LAST SEEN\ne1     open   server   TypeError  2026-01-01T00:00:00.000Z\n\nOops\n  save (pebble.ts:2:3)"],
  ["alerts ls", { incidents: [{ fingerprint: "fp1", pebble: "notes", rule: "readiness", job: "", opened: at, resolved: null }] }, "FINGERPRINT  PEBBLE  RULE       JOB  STATE  OPENED\nfp1          notes   readiness       open   2026-01-01T00:00:00.000Z\nNo active silences.\nDelivery: unknown (not included in this response).\nLast delivery failure: unknown."],
  ["metrics", { rows: [{ time: at, traffic: "ordinary", completions: 12, failures: 1, inflight: 2, p95: { headers_success: { lower: .01, upper: .025 } } }] }, "TIME                      TRAFFIC   COMPLETED  FAILURES  IN FLIGHT  P95 HEADERS\n2026-01-01T00:00:00.000Z  ordinary  12         1         2          0.01–0.025 s"],
  ["logs", { rows: [{ time: at, stream: "stdout", text: "hello" }] }, "TIME                      STREAM  TEXT\n2026-01-01T00:00:00.000Z  stdout  hello"],
  ["start", { name: "notes", status: "running" }, "✓ Started notes.\nNext: bedrock logs notes"],
  ["stop", { name: "notes", status: "stopped" }, "✓ Stopped notes.\nNext: bedrock start notes"],
  ["restart", { name: "notes", status: "running" }, "✓ Restarted notes.\nNext: bedrock logs notes"],
  ["rollback", { name: "notes", release: "releases/old" }, "✓ Rolled back notes to releases/old.\nNext: bedrock logs notes"],
  ["rm", { name: "notes", deleted: true }, "✓ Removed notes.\nNext: bedrock ls"],
  ["token create", { token: "br_secret" }, "✓ Created deploy token (shown once).\nbr_secret"],
  ["token revoke", { revoked: true }, "✓ Revoked deploy token.\nNext: bedrock token ls"],
  ["pebble-token create", { id: "pt1", token: "pt_secret" }, "✓ Created pebble token (shown once).\npt_secret\nID: pt1"],
  ["pebble-token revoke", { revoked: true }, "✓ Revoked pebble token."],
  ["session create", { url: "https://notes.test/#secret", expiresAt: at }, "✓ Created sign-in URL (shown once).\nhttps://notes.test/#secret\nExpires: 2026-01-01T00:00:00.000Z"],
  ["secrets set", { secrets: [{ name: "KEY", updatedAt: at }] }, "✓ Saved secrets (1 configured)."],
  ["secrets unset", { secrets: [] }, "✓ Removed requested secrets (0 configured)."],
  ["jobs run", { name: "sweep", skipped: false }, "✓ Ran sweep."],
  ["backup setup", { configured: true, target: { type: "fs", directory: "/backup" }, hint: "Within one minute." }, "✓ Configured backups: /backup.\nNext: bedrock backup run\nWithin one minute."],
  ["backup run", [manifest], "✓ Created backup 2026-01-01T00:00:00.000Z (notes/db/one.sqlite.gz)."],
  ["backup restore", { timestamp: stamp, previous: "/data.before" }, "✓ Restored backup 2026-01-01T00:00:00.000Z.\nNext: bedrock status\nPrevious data: /data.before"],
  ["errors resolve", { id: "e1", action: "resolve", target: null }, "✓ Resolved error issue e1."],
  ["errors ignore", { id: "e1", action: "ignore", target: null }, "✓ Ignored error issue e1."],
  ["errors merge", { id: "e1", action: "merge", target: "e2" }, "✓ Merged error issue e1 into e2."],
  ["alerts silence", { fingerprint: "fp1", until: at }, "✓ Silenced fp1 until 2026-01-01T00:00:00.000Z.\nNext: bedrock alerts"],
  ["alerts test", { id: "a1", queued: true }, "✓ Queued alert delivery test a1.\nNext: bedrock alerts"],
  ["alerts setup", { webhook: "https://hook.test", restart_required: true }, "✓ Configured alert webhook https://hook.test; restart the daemon to apply.\nNext: bedrock alerts test"],
  ["tunnel setup", { configured: true, name: "bedrock", hostname: "*.test", hint: "Restart the daemon." }, "✓ Configured tunnel bedrock (*.test).\nNext: bedrock tunnel status\nRestart the daemon."],
  ["tunnel status", { configured: true, tunnelId: "t1", tokenStored: true, matches: true, status: "healthy" }, "✓ Tunnel t1: healthy; credentials stored."],
  ["tunnel teardown", { removed: true }, "✓ Removed tunnel.\nNext: bedrock tunnel setup"],
  ["service install", { installed: true, path: "/unit", hint: "Enabled." }, "✓ Installed daemon service: /unit.\nNext: bedrock service status\nEnabled."],
  ["service uninstall", { installed: false }, "✓ Uninstalled daemon service."],
  ["service status", { installed: true, running: true }, "✓ Daemon service: running.\nNext: bedrock status"],
  ["db new", { file: "migrations/new.sql" }, "✓ Created migrations/new.sql.\nNext: bedrock db check"],
  ["db generate", { file: "migrations/new.sql", statements: 2, unmanagedTables: [], dataLoss: [] }, "✓ Generated migrations/new.sql (2 statements).\nNext: bedrock db check"],
  ["db check", { migrations: 2, unmanagedTables: [], message: "Migrations match the schema." }, "✓ Migrations match the schema. 2 migrations."],
  ["db plan", { pending: [{ name: "new.sql", sql: "select 1", hash: "h" }] }, "✓ 1 pending migrations.\nNext: bedrock db migrate\nnew.sql"],
  ["db migrate", { applied: ["new.sql"] }, "✓ Applied migrations: new.sql."],
  ["init", { name: "notes", dir: "/notes", created: true }, "✓ Initialized notes in /notes.\nNext: bedrock dev"],
  ["logout", { loggedOut: true }, "✓ Signed out."],
  ["data move", { moved: true, dataDir: "/data", bytes: 2048, pebbles: ["notes"] }, "✓ Moved 2.0 KiB to /data.\nNext: bedrock daemon"],
];

describe("command result formatters", () => {
  for (const [command, value, expected] of fixtures) {
    test(command, () => {
      const output = formatResult({ command, ok: true, value }, options);
      expect(output).toBe(expected);
      expect(output).not.toContain("\x1b");
    });
  }
});

test("local results and unwrapped secrets", () => {
  expect(formatResult({ command: "init", name: "notes", dir: "/notes", created: false }, options)).toBe("✓ Already initialized notes in /notes.\nNext: bedrock dev");
  expect(formatResult({ command: "secrets ls", secrets: [] }, options)).toBe("No secrets. Run bedrock secrets set <pebble> <NAME>.");
});

test("unknown commands and shapes fall back to JSON", () => {
  for (const result of [null, [], 1, "x", {}, { command: "toString" }, { command: "future" }, { command: "start" }, { command: "ls", value: {} }, { command: "ls", value: [1] }, { command: "start", ok: false }]) {
    expect(formatResult(result, options)).toBeUndefined();
  }
});

test("empty lists include a useful next command", () => {
  for (const command of ["ls", "token ls", "jobs ls", "jobs history", "backup ls"]) {
    expect(formatResult({ command, value: [] }, options)).toMatch(/^No .+\. .*bedrock .+\.$/);
  }
  for (const [command, value] of [["logs", { rows: [] }], ["metrics", { rows: [] }], ["errors list", { issues: [] }], ["alerts ls", { incidents: [] }]] as const) {
    expect(formatResult({ command, value }, options)?.split("\n")[0]).toMatch(/^No .+\. .*bedrock .+\.$/);
  }
});

test("narrow tables use vertical rows to preserve identifiers and sanitize controls", () => {
  const value = [{ name: "很长的名字🪨".repeat(8), cron: "* * * * *\n\x1b[31m", running: true }];
  for (const width of [1, 5, 15, 40, 80]) {
    const output = formatResult({ command: "jobs ls", value }, { color: false, width })!;
    expect(output).toContain(`JOB: ${value[0]!.name}`);
    expect(output).not.toContain("\x1b");
    expect(output).not.toContain("[31m");
  }
});

test("relative time and null metric percentiles", () => {
  const clock = spyOn(Date, "now").mockReturnValue(at + 180000);
  try {
    expect(formatResult({ command: "secrets ls", secrets: [{ name: "KEY", updatedAt: at }] }, options)).toBe("NAME  UPDATED\nKEY   3 min ago");
  } finally { clock.mockRestore(); }
  expect(formatResult({ command: "metrics", value: { rows: [{ time: at, p95: { headers_success: null } }] } }, options)).toContain("unknown");
});

test("skipped and already absent actions are truthful", () => {
  expect(formatResult({ command: "jobs run", value: { name: "sweep", skipped: true } }, options)).toBe("! Skipped sweep; already running.");
  expect(formatResult({ command: "token revoke", value: { revoked: false } }, options)).toBe("✓ Deploy token is already absent.\nNext: bedrock token ls");
  expect(formatResult({ command: "backup run", value: [{ skipped: "notes", warning: { message: "Busy" } }] }, options)).toBe("! Skipped notes: Busy");
  expect(formatResult({ command: "tunnel status", configured: false }, options)).toBe("! Tunnel is not configured.\nNext: bedrock tunnel setup");
});

test("color is opt-in and respects NO_COLOR", () => {
  const previous = process.env.NO_COLOR;
  try {
    delete process.env.NO_COLOR;
    expect(formatResult({ command: "logout", loggedOut: true }, { color: true })).toBe("\x1b[32m✓\x1b[0m Signed out.");
    process.env.NO_COLOR = "";
    expect(formatResult({ command: "logout", loggedOut: true }, { color: true })).toBe("✓ Signed out.");
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});

test("pagination, telemetry loss and migration warnings stay visible", () => {
  expect(formatResult({ command: "metrics", value: { rows: [], cursor: 123, drops: { queue: 2, empty: 0 }, retained_losses: { budget: 4 } } }, options)).toBe(
    "No metrics. Run bedrock status to check the pebble.\nMore results: pass --cursor 123.\n! drops: queue=2\n! retained_losses: budget=4",
  );
  expect(formatResult({ command: "db generate", file: "migrations/drop.sql", statements: 1, dataLoss: ["drop items"], unmanagedTables: ["legacy"] }, options)).toBe(
    "✓ Generated migrations/drop.sql (1 statements).\nNext: bedrock db check\n! Data loss: drop items\n! Unmanaged tables: legacy",
  );
  expect(formatResult({ command: "restart", value: { name: "notes", exclusive_services: "failed" } }, options)).toBe(
    "✓ Restarted notes.\nNext: bedrock logs notes\n! Exclusive services failed; inspect bedrock logs <pebble>.",
  );
});

test("raw logs, unchanged schemas and empty migration plans", () => {
  expect(formatResult({ command: "logs", logs: "hello\n" }, options)).toBe("hello");
  expect(formatResult({ command: "db generate", file: null, statements: 0, message: "Schema unchanged; no migration written." }, options)).toBe("✓ Schema unchanged; no migration written.");
  for (const [command, value] of [["db plan", { pending: [] }], ["db migrate", { applied: [] }]] as const) {
    expect(formatResult({ command, ...value }, options)).toBe("✓ No pending migrations.");
  }
});

test("actionable identifiers survive 60 columns in every list", () => {
  const id = "a".repeat(64), name = "nightly-backup-with-a-long-name";
  for (const [command, value, identifiers] of [
    ["token ls", [{ id, name, createdAt: at, scope: null }], [id, name]],
    ["backup ls", [manifest], [stamp]],
    ["errors list", { issues: [{ ...issue, id }] }, [id]],
    ["jobs ls", [{ name, cron: "* * * * *" }], [name]],
    ["jobs history", [{ job: name, run: id, at }], [name, id]],
    ["alerts ls", { incidents: [{ fingerprint: id, pebble: name }] }, [id, name]],
  ] as [string, unknown, string[]][]) {
    const output = formatResult({ command, value }, { color: false, width: 60 })!;
    for (const identifier of identifiers) expect(output).toContain(identifier);
  }
});

test("alerts show silence, queued test delivery, acceptance and failures without incidents", () => {
  const value = { incidents: [], silences: [{ fingerprint: "fp", until: at }], pending: { count: 1, oldest: at },
    outbox: [{ id: "test-1", created: at, state: "pending", attempts: 2, error: "HTTP_503" }], checks: [] };
  const render = () => formatResult({ command: "alerts ls", value }, options)!;
  for (const line of ["No alert incidents", "Active silences:", "fp", stamp, "1 pending", "test-1", "pending", "Last delivery failure: HTTP_503."]) expect(render()).toContain(line);
  value.outbox[0]!.state = "accepted";
  expect(render()).toContain("accepted");
});

test("status summarizes real telemetry, missing data and provenance; whoami focuses on identity", () => {
  const data = { daemon: "http://bedrock.localhost:3000", version: "1.0", user: "creator", pebbles: [
    { name: "notes", status: "running", readiness: { state: "ready" }, url: "http://notes.localhost:3000", memory: { resident: 1024 }, backup: { last_success_at: at },
      provenance: { branch: "main", commit: "123456789", dirty: false }, telemetry: { last_5m: { ordinary: { starts: 20, completions: 20, failures: 1, p95: { headers_success: { lower: .01, upper: .025 } } } } } },
    { name: "missing" },
  ] };
  const output = formatResult({ command: "status", ...data }, { color: false, width: 60 })!;
  for (const line of ["ready", "1.0 KiB", "REQUESTS (5m): 20", "5.0%", "0.01–0.025 s", "main@1234567", "unknown"]) expect(output).toContain(line);
  expect(output).not.toContain("Telemetry:");
  const identity = formatResult({ command: "whoami", ...data }, options)!;
  expect(identity).toContain("Daemon  http://bedrock.localhost:3000");
  expect(identity).toContain("User: creator");
  expect(identity).not.toContain("notes");
});

test("all supplied formatter text strips terminal sequences, preserving log tabs and newlines", () => {
  const unsafe = "\x1b]0;bad\x07hello\x1b[31m\tworld\nnext\x00";
  for (const result of [
    { command: "errors show", value: { issues: [issue], samples: [{ message: unsafe, frames: [{ file: unsafe, function: unsafe }] }] } },
    { command: "logs", logs: unsafe }, { command: "start", name: unsafe },
    { command: "jobs ls", value: [{ name: unsafe }] },
  ]) {
    const output = formatResult(result, options)!;
    expect(output).not.toMatch(/[\x00\x07\x1b]/);
    expect(output).not.toContain("[31m");
    expect(output).not.toContain("]0;bad");
  }
  expect(formatResult({ command: "logs", logs: unsafe }, options)).toBe("hello\tworld\nnext");
});

test("skipped or unverified tunnel checks never get a green success marker", () => {
  for (const remote of ["skipped", "unknown", "unverified"]) expect(formatResult({ command: "tunnel status", configured: true, tokenStored: true, remote }, options)).toStartWith("! ");
});
