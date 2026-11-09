// The CLI's single source of truth: help, usage hints, argument parsing,
// suggestions and shell completion are all derived from these specs, so they
// cannot drift apart. See docs/design/cli/DESIGN.md.

// Overview sections, in display order: build a pebble, ship and run, observe, access and secrets, run the server, this CLI.
export type Group = "build" | "ship" | "observe" | "access" | "server" | "cli";

export interface FlagSpec {
  /** Long form, e.g. "--follow". Parsed flags are always keyed by this name. */
  name: `--${string}`;
  /** Optional one-letter form, e.g. "-f". */
  short?: `-${string}`;
  /** Value placeholder such as "<url>"; absent means a boolean flag. */
  value?: string;
  summary: string;
  /** Allowed values; the parser rejects others and suggests the closest. */
  choices?: readonly string[];
  /** Never echo the value back (tokens, keys). */
  secret?: boolean;
  /** Unsupported spellings that should suggest this flag. */
  suggestFor?: readonly string[];
}

export interface ArgSpec {
  /** Placeholder name without brackets, e.g. "pebble". Completion offers pebble names for "pebble". */
  name: string;
  required?: boolean;
  /** Takes every remaining positional; must be last. */
  variadic?: boolean;
  summary?: string;
  choices?: readonly string[];
}

export interface Example { run: string; summary: string }

export interface CommandSpec {
  /** Word typed on the command line: "tunnel", or "setup" for a subcommand. */
  name: string;
  /** One line, sentence case, no trailing period; shown in lists. */
  summary: string;
  /** Longer explanation for `bedrock help <command>`; plain text, may span lines. */
  description?: string;
  /** Top-level commands only: the section they are listed under. */
  group?: Group;
  /** Accepted alternative spellings that run this command. Keep rare: one way to do each thing. */
  aliases?: readonly string[];
  /** Words that are not accepted but should suggest this command (e.g. "list" for "ls"). */
  suggestFor?: readonly string[];
  /** Omit from ties that also contain a non-destructive command. */
  destructive?: boolean;
  args?: readonly ArgSpec[];
  flags?: readonly FlagSpec[];
  subcommands?: readonly CommandSpec[];
  /** Subcommand used when the first positional is not a subcommand ("alerts" = "alerts ls"). */
  defaultSubcommand?: string;
  /** Talks to a daemon: accepts the shared --url and --token flags. */
  remote?: boolean;
  /** Hand-written synopsis lines (without "bedrock <path>") when the generated one would mislead. */
  usage?: readonly string[];
  examples?: readonly Example[];
  /** Section anchors in the shipped author guide, e.g. "AGENTS.md#error-tracking". */
  docs?: readonly string[];
  /** Internal commands (e.g. __dev_worker): runnable, never listed, suggested or completed. */
  hidden?: boolean;
}

/** What the shared parser hands a command implementation. */
export interface Parsed {
  /** Resolved command words, e.g. ["tunnel", "setup"]. */
  path: string[];
  spec: CommandSpec;
  positionals: string[];
  /** Keyed by long flag name; booleans are `true`. */
  flags: Record<string, string | true>;
}

/** Accepted by every command. */
export const globalFlags: readonly FlagSpec[] = [
  { name: "--json", summary: "Print one JSON value on stdout instead of text" },
  { name: "--help", short: "-h", summary: "Show this command's help and exit" },
];

/** Accepted by every `remote: true` command. */
export const remoteFlags: readonly FlagSpec[] = [
  { name: "--url", value: "<url>", summary: "Daemon URL, e.g. https://bedrock.example.com (default: local daemon, then bedrock login; env BEDROCK_URL)" },
  { name: "--token", value: "<token>", summary: "Bearer token for --url (default: saved login; env BEDROCK_TOKEN)", secret: true },
];

/**
 * A command implementation. index.ts parses argv against the registry first, so a handler sees only
 * input the spec allows and checks just the rules a spec cannot express (e.g. --dir excludes --r2-*).
 * Return the result object to print (text formatter or JSON), or undefined if it already printed.
 */
export type Handler = (parsed: Parsed, json: boolean) => Promise<unknown>;
