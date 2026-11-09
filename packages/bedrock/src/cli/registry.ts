import { commands } from "./commands";
import { suggest } from "../suggest";
import { globalFlags, remoteFlags, type CommandSpec, type FlagSpec } from "./spec";

export interface ResolvedCommand {
  path: string[];
  spec: CommandSpec;
  consumed: number;
}

export function visibleCommands(level: readonly CommandSpec[] = commands) {
  return level.filter(spec => !spec.hidden);
}

export function commandAt(word: string, level: readonly CommandSpec[] = commands) {
  return level.find(spec => spec.name === word || spec.aliases?.includes(word));
}

/** Defaults do not consume a word; help can opt out to describe the parent. */
export function resolveCommand(words: readonly string[], tree: readonly CommandSpec[] = commands, defaults = true): ResolvedCommand | undefined {
  let level = tree;
  let resolved: ResolvedCommand | undefined;
  let consumed = 0;
  while (level.length) {
    const spec = commandAt(words[consumed] ?? "", level);
    if (spec) {
      resolved = { path: [...(resolved?.path ?? []), spec.name], spec, consumed: ++consumed };
    } else {
      const fallback = defaults && resolved?.spec.defaultSubcommand;
      const spec = fallback ? commandAt(fallback, level) : undefined;
      if (!spec || !resolved) break;
      resolved = { path: [...resolved.path, spec.name], spec, consumed };
    }
    level = resolved.spec.subcommands ?? [];
  }
  return resolved;
}

export function candidatesFor(level: readonly CommandSpec[] = commands) {
  const visible = visibleCommands(level);
  const names = visible.flatMap(spec => [spec.name, ...(spec.aliases ?? [])]);
  const synonyms = Object.fromEntries(visible.flatMap(spec => (spec.suggestFor ?? []).map(word => [word, spec.name])));
  return { names, synonyms };
}

export function flagsFor(spec: CommandSpec) {
  const flags = [...(spec.flags ?? []), ...(spec.remote ? remoteFlags : []), ...globalFlags];
  return flags.filter((flag, i) => flags.findIndex(other => other.name === flag.name) === i);
}

/** Before a subcommand is known, its options must not be mistaken for command words. */
export function resolutionFlags(spec: CommandSpec): FlagSpec[] {
  return [...flagsFor(spec), ...(spec.subcommands ?? []).flatMap(resolutionFlags)];
}

export function flagAt(word: string, flags: readonly FlagSpec[]) {
  const key = word.split("=", 1)[0];
  return flags.find(flag => flag.name === key || flag.short === key);
}

export function acceptsValue(word: string | undefined, flags: readonly FlagSpec[]) {
  return word !== undefined && !word.startsWith("--") && !flagAt(word, flags);
}

export function suggestCommands(word: string, level: readonly CommandSpec[] = commands) {
  const { names, synonyms } = candidatesFor(level);
  const matches = suggest(word, names, synonyms);
  return matches.some(name => !commandAt(name, level)?.destructive)
    ? matches.filter(name => !commandAt(name, level)?.destructive) : matches;
}
