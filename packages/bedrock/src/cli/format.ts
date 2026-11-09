import { formatBuild, formatProvenance, type BuildInfo, type Provenance } from "../version";
import { marker, plain } from "./terminal";

type Row = Record<string, unknown>;
interface Options { color: boolean; width?: number }
type Formatter = (value: unknown, options: Options) => string | undefined;
type Column = readonly [heading: string, cell: (row: Row) => unknown, identifier?: boolean];
const object = (value: unknown): Row | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
const rows = (value: unknown): Row[] | undefined => Array.isArray(value) && value.every(item => object(item)) ? value as Row[] : undefined;
const text = (value: unknown): string => value === undefined || value === null ? "—" : Array.isArray(value) ? value.map(text).join(", ") : typeof value === "object" ? "—" : plain(String(value));
const cell = (value: unknown) => text(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

function time(value: unknown, relative = false): string {
  if (typeof value !== "string" && typeof value !== "number") return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const age = Date.now() - date.getTime();
  if (relative && age >= 0 && age < 86400000) {
    if (age < 60000) return "just now";
    return age < 3600000 ? `${Math.floor(age / 60000)} min ago` : `${Math.floor(age / 3600000)} h ago`;
  }
  return date.toISOString();
}

function bytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  const unit = Math.min(3, Math.floor(Math.log2(Math.max(1, value)) / 10));
  return `${unit ? (value / 1024 ** unit).toFixed(1) : value} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}

function truncate(value: string, width: number) {
  if (Bun.stringWidth(value) <= width) return value;
  let result = "";
  for (const char of value) {
    if (Bun.stringWidth(result + char) + 1 > width) break;
    result += char;
  }
  return width > 0 ? result + "…" : "";
}

function table(data: Row[], columns: readonly Column[], width?: number): string {
  const grid = [columns.map(([heading]) => heading), ...data.map(row => columns.map(([, read]) => cell(read(row))))];
  const sizes = columns.map((_, i) => Math.max(...grid.map(row => Bun.stringWidth(row[i]!))));
  const limit = width === undefined || !Number.isFinite(width) ? Infinity : Math.max(1, Math.floor(width));
  const total = () => sizes.reduce((sum, size) => sum + size, 0) + (sizes.length - 1) * 2;
  while (total() > limit) {
    const optional = sizes.map((size, i) => columns[i]![2] || size <= Bun.stringWidth(columns[i]![0]) ? 0 : size);
    const widest = optional.indexOf(Math.max(...optional));
    if (optional[widest]! <= 1) break;
    sizes[widest]!--;
  }
  // Copyable identifiers matter more than fitting an impossibly narrow terminal.
  if (total() > limit) return data.map(row => columns.map(([heading, read]) => `${heading}: ${cell(read(row))}`).join("\n")).join("\n\n");
  return grid.map(row => truncate(row.map((value, i) => {
    const clipped = truncate(value, sizes[i]!);
    return clipped + " ".repeat(Math.max(0, sizes[i]! - Bun.stringWidth(clipped)));
  }).join("  ").trimEnd(), limit)).join("\n");
}

function confirmation(message: string, options: Options, next?: string, kind: "✓" | "!" | "✗" = "✓") {
  return `${marker(kind, options.color)} ${message}${next ? `\nNext: bedrock ${next}` : ""}`;
}

function list(columns: readonly Column[], empty: string, select: (value: unknown) => unknown = value => value): Formatter {
  return (value, options) => {
    const data = rows(select(value));
    return data ? data.length ? table(data, columns, options.width) : empty : undefined;
  };
}

function action(required: string, render: (value: Row, options: Options) => string): Formatter {
  return (value, options) => {
    const data = object(value);
    return data && required in data ? render(data, options) : undefined;
  };
}

const pebbleColumns: Column[] = [
  ["NAME", row => row.name, true], ["STATUS", row => row.status], ["PID", row => row.pid],
  ["MEMORY", row => bytes(object(row.memory)?.resident)], ["PUBLIC ROUTES", row => row.public_routes], ["SOURCE", row => plain(formatProvenance(row.provenance as Provenance))],
];
const issueColumns: Column[] = [
  ["ISSUE", row => row.id, true], ["STATE", row => row.state], ["RUNTIME", row => row.runtime],
  ["TYPE", row => row.type], ["LAST SEEN", row => time(row.last_seen, true)],
];

const formatters: Record<string, Formatter> = {
  ls: list(pebbleColumns, "No pebbles yet. Run bedrock new my-app."),
  "token ls": list([
    ["ID", row => row.id, true], ["NAME", row => row.name, true], ["CREATED", row => time(row.createdAt, true)],
    ["PEBBLES", row => row.scope === null ? "*" : object(row.scope)?.pebbles],
    ["ACTIONS", row => row.scope === null ? "all" : object(row.scope)?.actions],
  ], "No deploy tokens. Run bedrock token create."),
  "secrets ls": list([["NAME", row => row.name, true], ["UPDATED", row => time(row.updatedAt, true)]],
    "No secrets. Run bedrock secrets set <pebble> <NAME>.", value => object(value)?.secrets),
  "jobs ls": list([["JOB", row => row.name, true], ["CRON", row => row.cron], ["STATUS", row => row.running ? "running" : "idle"]],
    "No jobs. Define a job in pebble.ts, then run bedrock deploy."),
  "jobs history": list([["JOB", row => row.job, true], ["STATE", row => row.state], ["TIME", row => time(row.at, true)], ["RUN", row => row.run, true]],
    "No job history. Run bedrock jobs ls <pebble>."),
  "backup ls": list([["TIMESTAMP", row => time(row.timestamp), true], ["VERSION", row => row.version],
    ["FILES", row => Object.keys(object(row.files) ?? {}).length], ["DATABASE", row => row.db]],
    "No backups. Run bedrock backup run <pebble>."),
  "errors list": list(issueColumns, "No error issues. Run bedrock logs <pebble> to inspect logs.", value => object(value)?.issues),
  "errors show": (value, options) => {
    const data = object(value), issues = rows(data?.issues), samples = rows(data?.samples);
    if (!issues || !samples) return undefined;
    const summary = table(issues, issueColumns, options.width);
    const details = samples.map(sample => [text(sample.message), ...(rows(sample.frames) ?? []).map(frame => `  ${text(frame.function)} (${text(frame.file)}:${text(frame.line)}:${text(frame.column)})`)].join("\n")).join("\n\n");
    return `${summary}${details ? `\n\n${details}` : "\nNo retained samples."}`;
  },
  "alerts ls": (value, options) => {
    const data = object(value), incidents = rows(data?.incidents);
    if (!data || !incidents) return undefined;
    const lines = [incidents.length ? table(incidents, [
      ["FINGERPRINT", row => row.fingerprint, true], ["PEBBLE", row => row.pebble || "daemon", true],
      ["RULE", row => row.rule], ["JOB", row => row.job, true], ["STATE", row => row.resolved === null ? "open" : "resolved"],
      ["OPENED", row => time(row.opened, true)],
    ], options.width) : "No alert incidents. Run bedrock alerts test to check delivery."];
    const silences = rows(data.silences);
    lines.push(silences?.length ? "Active silences:\n" + table(silences, [["FINGERPRINT", row => row.fingerprint, true], ["UNTIL", row => time(row.until), true]], options.width) : "No active silences.");
    const pending = object(data.pending), outbox = rows(data.outbox);
    lines.push(pending ? `Delivery: ${text(pending.count)} pending; oldest: ${pending.oldest == null ? "none" : time(pending.oldest)}.` : "Delivery: unknown (not included in this response).");
    if (outbox?.length) lines.push(table(outbox, [["ID", row => row.id, true], ["STATE", row => row.state], ["ATTEMPTS", row => row.attempts], ["ERROR", row => row.error]], options.width));
    const checks = rows(data.checks);
    if (checks?.length) lines.push("Checks:\n" + table(checks, [["NAME", row => row.name, true], ["FAILURES", row => row.failures], ["UNHEALTHY", row => row.unhealthy], ["OBSERVED", row => time(row.observed)]], options.width));
    const failures = [...(outbox ?? []).filter(row => row.error).map(row => ({ at: row.created, error: row.error })), ...(rows(data.checks) ?? []).filter(row => row.error).map(row => ({ at: row.observed, error: row.error }))];
    failures.sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0));
    lines.push(`Last delivery failure: ${failures.length ? text(failures[0]!.error) : outbox ? "none" : "unknown"}.`);
    return lines.join("\n");
  },
  status: (value, options) => status(value, options, false),
  whoami: (value, options) => status(value, options, true),
  metrics: list([["TIME", row => time(row.time)], ["TRAFFIC", row => row.traffic], ["COMPLETED", row => row.completions],
    ["FAILURES", row => row.failures], ["IN FLIGHT", row => row.inflight], ["P95 HEADERS", row => percentile(object(row.p95)?.headers_success)]],
    "No metrics. Run bedrock status to check the pebble.", value => object(value)?.rows),
  logs: (value, options) => {
    const data = object(value);
    if (rows(data?.rows)) return list([["TIME", row => time(row.time)], ["STREAM", row => row.stream], ["TEXT", row => row.text]],
      "No logs. Run bedrock status to check the pebble.", value => object(value)?.rows)(value, options);
    return typeof data?.logs === "string" ? plain(data.logs).trimEnd() || "No logs. Run bedrock status to check the pebble." : undefined;
  },
  start: action("name", (v, o) => confirmation(`Started ${text(v.name)}.`, o, `logs ${text(v.name)}`)),
  stop: action("name", (v, o) => confirmation(`Stopped ${text(v.name)}.`, o, `start ${text(v.name)}`)),
  restart: action("name", (v, o) => confirmation(`Restarted ${text(v.name)}.`, o, `logs ${text(v.name)}`)),
  rollback: action("name", (v, o) => confirmation(`Rolled back ${text(v.name)} to ${text(v.release)}.`, o, `logs ${text(v.name)}`)),
  rm: action("deleted", (v, o) => confirmation(v.deleted ? `Removed ${text(v.name)}.` : `${text(v.name)} is already absent.`, o, "ls")),
  "token create": action("token", (v, o) => `${confirmation("Created deploy token (shown once).", o)}\n${text(v.token)}`),
  "token revoke": action("revoked", (v, o) => confirmation(v.revoked ? "Revoked deploy token." : "Deploy token is already absent.", o, "token ls")),
  "pebble-token create": action("token", (v, o) => `${confirmation("Created pebble token (shown once).", o)}\n${text(v.token)}\nID: ${text(v.id)}`),
  "pebble-token revoke": action("revoked", (v, o) => confirmation("Revoked pebble token.", o)),
  "session create": action("url", (v, o) => `${confirmation("Created sign-in URL (shown once).", o)}\n${text(v.url)}\nExpires: ${time(v.expiresAt)}`),
  "secrets set": action("secrets", (v, o) => confirmation(`Saved secrets (${rows(v.secrets)?.length ?? 0} configured).`, o)),
  "secrets unset": action("secrets", (v, o) => confirmation(`Removed requested secrets (${rows(v.secrets)?.length ?? 0} configured).`, o)),
  "jobs run": action("skipped", (v, o) => confirmation(v.skipped ? `Skipped ${text(v.name)}; already running.` : `Ran ${text(v.name)}.`, o, undefined, v.skipped ? "!" : "✓")),
  "backup setup": action("configured", (v, o) => `${confirmation(`Configured backups: ${text(object(v.target)?.directory ?? object(v.target)?.bucket)}.`, o, "backup run")}\n${text(v.hint)}`),
  "backup run": (value, options) => {
    const data = rows(value);
    return data ? data.map(v => v.skipped ? confirmation(`Skipped ${text(v.skipped)}: ${text(object(v.warning)?.message)}`, options, undefined, "!")
      : confirmation(`Created backup ${time(v.timestamp)} (${text(v.db)}).`, options)).join("\n") || "No backups created. Run bedrock backup setup --dir <path>." : undefined;
  },
  "backup restore": action("timestamp", (v, o) => `${confirmation(`Restored backup ${time(v.timestamp)}.`, o, "status")}\nPrevious data: ${text(v.previous)}`),
  "errors resolve": action("id", (v, o) => confirmation(`Resolved error issue ${text(v.id)}.`, o)),
  "errors ignore": action("id", (v, o) => confirmation(`Ignored error issue ${text(v.id)}.`, o)),
  "errors merge": action("id", (v, o) => confirmation(`Merged error issue ${text(v.id)} into ${text(v.target)}.`, o)),
  "alerts silence": action("fingerprint", (v, o) => confirmation(`Silenced ${text(v.fingerprint)} until ${time(v.until)}.`, o, "alerts")),
  "alerts test": action("queued", (v, o) => confirmation(`Queued alert delivery test ${text(v.id)}.`, o, "alerts")),
  "alerts setup": action("webhook", (v, o) => confirmation(`Configured alert webhook ${text(v.webhook)}; restart the daemon to apply.`, o, "alerts test")),
  "tunnel setup": action("configured", (v, o) => `${confirmation(`Configured tunnel ${text(v.name)} (${text(v.hostname)}).`, o, "tunnel status")}\n${text(v.hint)}`),
  "tunnel status": action("configured", (v, o) => {
    if (!v.configured) return confirmation("Tunnel is not configured.", o, "tunnel setup", "!");
    const healthy = v.tokenStored === true && v.matches !== false && ["healthy", "active", "up"].includes(text(v.status ?? v.remote));
    return confirmation(`Tunnel ${text(v.tunnelId)}: ${text(v.status ?? v.remote)}; credentials ${v.tokenStored ? "stored" : "missing"}${v.matches === false ? "; ingress mismatch" : ""}.`, o, undefined, healthy ? "✓" : "!") + (v.hint ? `\n${text(v.hint)}` : "");
  }),
  "tunnel teardown": action("removed", (v, o) => confirmation(v.removed ? "Removed tunnel." : "Tunnel is already absent.", o, "tunnel setup")),
  "service install": action("installed", (v, o) => `${confirmation(`Installed daemon service: ${text(v.path)}.`, o, "service status")}\n${text(v.hint)}`),
  "service uninstall": action("installed", (v, o) => confirmation("Uninstalled daemon service.", o)),
  "service status": action("installed", (v, o) => confirmation(`Daemon service: ${v.installed ? v.running ? "running" : "stopped" : "not installed"}.`, o, v.installed ? "status" : "service install", v.running ? "✓" : "!")),
  "db new": action("file", (v, o) => confirmation(`Created ${text(v.file)}.`, o, "db check")),
  "db generate": action("file", (v, o) => confirmation(v.file ? `Generated ${text(v.file)} (${text(v.statements)} statements).` : text(v.message), o, v.file ? "db check" : undefined)),
  "db check": action("migrations", (v, o) => confirmation(`${text(v.message)} ${text(v.migrations)} migrations.`, o)),
  "db plan": action("pending", (v, o) => {
    const pending = rows(v.pending);
    return pending?.length ? `${confirmation(`${pending.length} pending migrations.`, o, "db migrate")}\n${pending.map(row => text(row.name)).join("\n")}` : confirmation("No pending migrations.", o);
  }),
  "db migrate": action("applied", (v, o) => confirmation(Array.isArray(v.applied) && v.applied.length ? `Applied migrations: ${text(v.applied)}.` : "No pending migrations.", o)),
  init: action("dir", (v, o) => confirmation(`${v.created ? "Initialized" : "Already initialized"} ${text(v.name)} in ${text(v.dir)}.`, o, "dev")),
  logout: action("loggedOut", (_, o) => confirmation("Signed out.", o)),
  "data move": action("dataDir", (v, o) => `${confirmation(v.moved ? `Moved ${bytes(v.bytes)} to ${text(v.dataDir)}.` : `Data is already in ${text(v.dataDir)}.`, o, "daemon")}${v.hint ? `\n${text(v.hint)}` : ""}`),
};

function backupAge(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "unknown";
  const age = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(age)) return "unknown";
  return age >= 86400000 ? `${Math.floor(age / 86400000)} d ago` : time(value, true);
}

function status(value: unknown, options: Options, identity: boolean) {
  const data = object(value), pebbles = rows(data?.pebbles);
  if (!data || !pebbles) return undefined;
  const header = `Daemon  ${text(data.daemon)} · ${plain(formatBuild(data as Partial<BuildInfo>))}\nUser: ${text(data.user ?? "creator deploy token")}`;
  if (identity) return header;
  const summary = pebbles.map(pebble => {
    const telemetry = object(pebble.telemetry), window = object(telemetry?.last_5m);
    const classes: Row[] = window ? Object.entries(window).flatMap(([traffic, value]) => object(value) ? [{ ...object(value)!, traffic }] : []) : [];
    const known = window && !telemetry?.unavailable;
    const requests = classes.reduce((sum, row) => sum + Number(row.starts ?? 0), 0);
    const completed = classes.reduce((sum, row) => sum + Number(row.completions ?? 0), 0);
    const failed = classes.reduce((sum, row) => sum + Number(row.failures ?? 0), 0);
    const latency = classes.map(row => `${text(row.traffic ?? "ordinary")}: ${percentile(object(row.p95)?.headers_success)}`).join(", ");
    const backup = object(pebble.backup)?.last_success_at;
    return {
      ...pebble, readiness: object(pebble.readiness)?.state ?? "unknown",
      memory: bytes(object(pebble.memory)?.resident ?? object(telemetry?.resources)?.resident).replace("—", "unknown"),
      requests: known ? requests : "unknown", failures: known && completed ? `${(failed / completed * 100).toFixed(1)}%` : "unknown",
      p95: known && latency ? latency : "unknown", backup: backup == null ? "unknown" : backupAge(backup),
    };
  });
  return header + "\n" + (summary.length ? table(summary, [
    ["NAME", row => row.name, true], ["STATUS", row => row.status ?? "unknown"], ["READY", row => row.readiness],
    ["URL", row => row.url, true], ["MEMORY", row => row.memory], ["REQUESTS (5m)", row => row.requests],
    ["FAILURES (5m)", row => row.failures], ["P95 HEADERS (5m)", row => row.p95], ["BACKUP", row => row.backup],
    ["SOURCE", row => plain(formatProvenance(row.provenance as Provenance))],
  ], options.width) : "No pebbles yet. Run bedrock new my-app.");
}

function percentile(value: unknown) {
  const range = object(value);
  return range ? `${text(range.lower)}–${range.upper === null ? "∞" : text(range.upper)} s` : "unknown";
}

export function formatResult(result: unknown, options: Options): string | undefined {
  const data = object(result);
  if (!data || typeof data.command !== "string" || data.ok === false) return undefined;
  const formatter = Object.hasOwn(formatters, data.command) ? formatters[data.command] : undefined;
  if (!formatter) return undefined;
  const value = Object.hasOwn(data, "value") ? data.value : data;
  const output = formatter(value, options);
  if (output === undefined) return undefined;
  return output + notes(object(value), options);
}

function notes(value: Row | undefined, options: Options): string {
  if (!value) return "";
  const lines: string[] = [];
  if (value.cursor !== undefined && value.cursor !== null) lines.push(`More results: pass --cursor ${text(value.cursor)}.`);
  if (value.exclusive_services === "failed") lines.push(`${marker("!", options.color)} Exclusive services failed; inspect bedrock logs <pebble>.`);
  for (const [key, label] of [["dataLoss", "Data loss"], ["unmanagedTables", "Unmanaged tables"]] as const) {
    if (Array.isArray(value[key]) && value[key].length) lines.push(`${marker("!", options.color)} ${label}: ${text(value[key])}`);
  }
  for (const key of ["drops", "historical_drops", "retained_losses"]) {
    const counts = object(value[key]);
    const losses = counts && Object.entries(counts).filter(([, count]) => typeof count === "number" && count > 0);
    if (losses?.length) lines.push(`${marker("!", options.color)} ${key}: ${losses.map(([reason, count]) => `${text(reason)}=${text(count)}`).join(", ")}`);
  }
  return lines.length ? "\n" + lines.join("\n") : "";
}
