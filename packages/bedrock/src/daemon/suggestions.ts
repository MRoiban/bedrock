import { BedrockError } from "../error";
import { suggest } from "../suggest";
import { authorizeScope, matchesPebble, type TokenScope } from "./token-scope";
import type { DaemonDatabase } from "./db";
import type { Supervisor } from "./supervisor";

export async function suggestDaemonError(error: unknown, request: Request, scope: TokenScope | null, db: DaemonDatabase, supervisor: Supervisor, backups?: ReturnType<typeof import("../backup").createBackups>) {
  if (!(error instanceof BedrockError)) return error;
  try {
    const url = new URL(request.url);
    const pebble = /^\/api\/(?:pebbles|jobs)\/([^/]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get("name");
    const authorizeListing = (path: string) => authorizeScope(scope, new Request(new URL(path, url)));
    if (error.code === "PEBBLE_NOT_FOUND" && pebble) {
      authorizeListing("/api/pebbles");
      return withSuggestions(error, pebble, db.list().filter(record => !scope || matchesPebble(scope, record.name)).map(record => record.name));
    }
    const issue = /^\/api\/pebbles\/([^/]+)\/errors\/([^/]+)(?:\/[^/]+)?$/.exec(url.pathname);
    if (error.code === "NOT_FOUND" && issue && supervisor.telemetry) {
      const unknown = error.message === "Merge target not found." ? url.searchParams.get("target") : issue[2];
      if (!unknown) return error;
      authorizeListing(`/api/pebbles/${issue[1]}/errors`);
      return withSuggestions(error, unknown, await supervisor.telemetry.errors.suggestionIds(issue[1]!));
    }
    if (error.code === "JOB_NOT_FOUND" && pebble && url.pathname === `/api/jobs/${pebble}`) {
      authorizeListing(`/api/jobs/${pebble}`);
      const jobs = await supervisor.jobs(pebble) as { name: string }[];
      return withSuggestions(error, url.searchParams.get("job") ?? "", jobs.map(job => job.name));
    }
    if (error.code === "BACKUP_NOT_FOUND" && pebble && backups) {
      const at = url.searchParams.get("at");
      if (!at) return error;
      authorizeListing(`/api/backup/ls?${new URLSearchParams({ name: pebble })}`);
      return withSuggestions(error, at, nearestSnapshots(at, (await backups.list(pebble)).map(snapshot => snapshot.timestamp)), true);
    }
  } catch {
    // Suggestions are optional: permission or listing failures must preserve the failed lookup.
  }
  return error;
}

// Callers supply only candidates from the same authorized listing as the failed lookup.
export function withSuggestions(error: BedrockError, unknown: string, candidates: readonly string[], ranked = false) {
  const suggestions = ranked ? [...candidates] : suggest(unknown, candidates);
  if (!suggestions.length) return error;
  return new BedrockError(error.code, error.message,
    `Did you mean ${suggestions.map(name => `'${name}'`).join(" or ")}? ${error.hint}`,
    error.detail, { status: error.status, data: { unknown, suggestions } });
}

export function nearestSnapshots(unknown: string, candidates: readonly string[]) {
  const time = Date.parse(unknown);
  if (!Number.isFinite(time)) return suggest(unknown, candidates);
  return [...new Set(candidates)].filter(candidate => Number.isFinite(Date.parse(candidate)))
    .sort((a, b) => Math.abs(Date.parse(a) - time) - Math.abs(Date.parse(b) - time) || a.localeCompare(b)).slice(0, 5);
}
