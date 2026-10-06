import { AsyncLocalStorage } from "node:async_hooks";
import type { Logger } from "drizzle-orm/logger";

export interface TableUsage {
  reads: Set<string>;
  writes: Set<string>;
}

// Ignore literals and comments so user data cannot masquerade as a table name.
export function sqlTokens(sql: string): string[] {
  const parts = sql.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[A-Za-z_][\w$]*|[.;]/g) ?? [];
  return parts.filter(p => !p.startsWith("--") && !p.startsWith("/*") && !p.startsWith("'"))
    .map(p => p.startsWith('"') ? p.slice(1, -1).replaceAll('""', '"')
      : p.startsWith("`") || p.startsWith("[") ? p.slice(1, -1) : p);
}

export class TableTracker implements Logger {
  private readonly calls = new AsyncLocalStorage<TableUsage>();
  private readonly known: Map<string, string>;

  constructor(tables: Iterable<string>) {
    this.known = new Map([...tables].map(name => [name.toLowerCase(), name]));
  }

  logQuery(sql: string, _params: unknown[]) {
    const usage = this.calls.getStore();
    if (!usage) return;
    const tokens = sqlTokens(sql);
    let statement: string[] = [];
    for (const token of [...tokens, ";"]) {
      if (token !== ";") { statement.push(token); continue; }
      this.record(statement, usage);
      statement = [];
    }
  }

  private record(tokens: string[], usage: TableUsage) {
    const lower = tokens.map(t => t.toLowerCase());
    const hasRead = lower.some(t => ["select", "update", "delete"].includes(t));
    // Over-recording known identifiers is intentional: missed reads break invalidation.
    if (hasRead) {
      for (const token of lower) {
        const name = this.known.get(token);
        if (name) usage.reads.add(name);
      }
    }
    for (let i = 0; i < lower.length; i++) {
      const token = lower[i];
      const isTarget = token === "into" || token === "update" ||
        (token === "from" && lower[i - 1] === "delete") ||
        (token === "table" && lower.some(t => ["create", "drop", "alter"].includes(t)));
      if (!isTarget) continue;
      let offset = i + 1;
      while (["or", "abort", "fail", "ignore", "replace", "rollback", "if", "not", "exists"].includes(lower[offset] ?? "")) offset++;
      if (lower[offset + 1] === ".") offset += 2;
      const name = this.known.get(lower[offset] ?? "");
      if (name) usage.writes.add(name);
    }
  }

  async capture<T>(fn: () => T | PromiseLike<T>): Promise<{ value: Awaited<T> } & TableUsage> {
    const usage: TableUsage = { reads: new Set(), writes: new Set() };
    const value = await this.calls.run(usage, async () => await fn());
    return { value, ...usage };
  }
}
