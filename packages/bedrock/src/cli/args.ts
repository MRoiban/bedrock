import { BedrockError } from "../error";
import { suggest } from "../suggest";
import { commands } from "./commands";
import { usageSynopses } from "./help";
import { acceptsValue, commandAt, flagAt, flagsFor, resolutionFlags, resolveCommand, suggestCommands, visibleCommands } from "./registry";
import { globalFlags, remoteFlags, type CommandSpec, type Parsed } from "./spec";

export function usageError(path: readonly string[], message: string, suggestions: readonly string[] = [], tree: readonly CommandSpec[] = commands) {
  const resolved = resolveCommand(path, tree, false);
  const usage = resolved ? usageSynopses(resolved.path, resolved.spec).join("\n       ") : `bedrock ${path.join(" ")}`;
  return new BedrockError("INVALID_ARGS", message, `usage: ${usage}\nRun 'bedrock help ${path.join(" ")}' for details.`, undefined,
    suggestions.length ? { data: { suggestions } } : {});
}

function secretFlags(tree: readonly CommandSpec[]) {
  return [...remoteFlags, ...tree.flatMap(resolutionFlags)].filter(flag => flag.secret);
}

function knownFlags(tree: readonly CommandSpec[]) {
  return [...globalFlags, ...remoteFlags, ...tree.flatMap(resolutionFlags)];
}

/** A secret flag, or an unknown option whose nearest flag is secret (`--api-tokne`): its value must not be echoed either. */
function secretAt(word: string, tree: readonly CommandSpec[]) {
  const secrets = secretFlags(tree);
  const exact = flagAt(word, secrets);
  const known = knownFlags(tree);
  if (exact || !word.startsWith("--") || flagAt(word, known)) return exact;
  const nearest = suggest(optionName(word), [...new Set(known.map(flag => flag.name))]);
  return secrets.find(flag => nearest.includes(flag.name));
}

/** Whether the word after a secret flag may be its value. Redaction errs safe: only a `--` word is never one. */
function secretValue(word: string | undefined) {
  return word !== undefined && !word.startsWith("--");
}

function optionName(word: string) {
  return word.startsWith("-") ? word.split("=", 1)[0]! : word;
}

/** Error messages never quote inline option values or words following secret flags. */
export function diagnosticWord(argv: readonly string[], index: number, tree: readonly CommandSpec[] = commands) {
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (word === "--") break;
    const flag = secretAt(word, tree);
    if (flag && !word.includes("=") && secretValue(argv[i + 1])) {
      if (index === i + 1) return flag.value ?? "<secret>";
      i++;
    }
  }
  return optionName(argv[index] ?? "");
}

function shellWord(word: string) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** Used by parser errors and daemon name suggestions; argv includes the command. */
export function replaySuggestions(argv: readonly string[], unknown: number | string, replacements: readonly string[], tree: readonly CommandSpec[] = commands): string[] {
  const index = typeof unknown === "number" ? unknown : argv.indexOf(unknown);
  if (index < 0) return [];
  return replacements.map(replacement => {
    const words = argv.map((word, at) => at === index ? replacement : word);
    const safe: string[] = [];
    let options = true;
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!;
      if (word === "--") { options = false; safe.push(word); continue; }
      const secret = options && (secretAt(argv[i]!, tree) ?? secretAt(word, tree));
      if (secret) {
        safe.push(flagAt(word, secretFlags(tree)) ? secret.name : optionName(word), secret.value ?? "<secret>");
        if (!argv[i]!.includes("=") && secretValue(argv[i + 1])) i++;
      } else safe.push(shellWord(word));
    }
    return `bedrock ${safe.join(" ")}`;
  });
}

interface Word { value: string; index: number }

function firstPositional(words: readonly Word[], spec: CommandSpec) {
  const flags = resolutionFlags(spec);
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word.value === "--") return undefined;
    if (!word.value.startsWith("-") || word.value === "-") return word;
    const flag = flagAt(word.value, flags);
    if (flag?.value && !word.value.includes("=") && acceptsValue(words[i + 1]?.value, flags)) i++;
  }
}

function joinedNames(spec: CommandSpec) {
  const names = visibleCommands(spec.subcommands ?? []).map(sub => sub.name);
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** Optional tree keeps unit tests independent from the shipped registry data. */
export function parse(path: string[], argv: string[], tree: readonly CommandSpec[] = commands): Parsed {
  return parseLocated(path, argv, tree).parsed;
}

function parseLocated(path: string[], argv: string[], tree: readonly CommandSpec[]) {
  const resolved = resolveCommand(path, tree, false);
  if (!resolved || resolved.consumed !== path.length) throw usageError(path, `Unknown command bedrock ${path.join(" ")}.`, [], tree);
  const original = [...path, ...argv];
  let words = argv.map((value, i) => ({ value, index: path.length + i }));
  let currentPath = resolved.path;
  let spec = resolved.spec;
  let fallback: (() => BedrockError) | undefined;
  const fail: (message: string, suggestions?: string[]) => never = (message, suggestions = []) => { throw usageError(currentPath, message, suggestions, tree); };
  const unknownSubcommand = (parentPath: string[], parent: CommandSpec, word: Word) => {
    return usageError(parentPath, `'${diagnosticWord(original, word.index, tree)}' is not a bedrock ${parentPath.join(" ")} command.`,
      replaySuggestions(original, word.index, suggestCommands(word.value, parent.subcommands), tree), tree);
  };

  while (spec.subcommands?.length) {
    const word = firstPositional(words, spec);
    const child = word && commandAt(word.value, spec.subcommands);
    if (child) {
      const defaultSpec = commandAt(spec.defaultSubcommand ?? "", spec.subcommands);
      // "errors --cursor 100 resolve" lists the pebble named resolve: fall back when only the default form accepts the words.
      if (defaultSpec && acceptsArity(words.filter(entry => entry !== word), child, currentPath, original, tree) !== true
        && acceptsArity(words, defaultSpec, currentPath, original, tree)) {
        spec = defaultSpec;
        currentPath = [...currentPath, defaultSpec.name];
        continue;
      }
      words = words.filter(entry => entry !== word);
      spec = child;
      currentPath = [...currentPath, child.name];
    } else if (spec.defaultSubcommand) {
      const child = commandAt(spec.defaultSubcommand, spec.subcommands);
      if (!child) fail(`Invalid default subcommand '${spec.defaultSubcommand}'.`);
      const parent = spec, parentPath = currentPath;
      if (word && suggestCommands(word.value, spec.subcommands).length) {
        fallback = () => unknownSubcommand(parentPath, parent, word);
      }
      spec = child;
      currentPath = [...currentPath, child.name];
    } else {
      // Diagnose bad options before a missing/unknown subcommand.
      parseWords(words.filter(entry => !word || entry.index < word.index), spec, currentPath, original, tree, resolutionFlags(spec));
      if (word) throw unknownSubcommand(currentPath, spec, word);
      fail(`bedrock ${currentPath.join(" ")} needs a subcommand: ${joinedNames(spec)}.`);
    }
  }

  const { positionals, flags, positionalWords, flagWords } = parseWords(words, spec, currentPath, original, tree);
  const args = spec.args ?? [];
  const missing = args.find((arg, i) => arg.required && positionalWords[i] === undefined);
  const extra = !args.at(-1)?.variadic && positionalWords[args.length];
  if ((missing || extra) && fallback) throw fallback();
  if (missing) fail(`bedrock ${currentPath.join(" ")} needs <${missing.name}>.`);
  if (extra) fail(`Unexpected argument '${diagnosticWord(original, extra.index, tree)}' for bedrock ${currentPath.join(" ")}.`);
  for (let i = 0; i < positionalWords.length; i++) {
    const arg = args[i] ?? (args.at(-1)?.variadic ? args.at(-1) : undefined);
    const word = positionalWords[i]!;
    if (arg?.choices && !arg.choices.includes(word.value)) {
      fail(`Invalid value '${diagnosticWord(original, word.index, tree)}' for <${arg.name}>; choose ${arg.choices.join(", ")}.`, replaySuggestions(original, word.index, suggest(word.value, arg.choices), tree));
    }
  }
  return { parsed: { path: currentPath, spec, positionals, flags }, positionalWords, flagWords };
}

function acceptsArity(words: readonly Word[], spec: CommandSpec, path: string[], original: string[], tree: readonly CommandSpec[]) {
  try {
    const { positionals } = parseWords(words, spec, path, original, tree);
    const args = spec.args ?? [];
    return !args.some((arg, i) => arg.required && positionals[i] === undefined)
      && (args.at(-1)?.variadic || positionals.length <= args.length);
  } catch { return undefined; }
}

/** Locate a daemon-rejected value among parsed arguments, excluding command words and credentials. */
export function locateValue(argv: string[], unknown: string, argument?: string): { index: number; prefix: string } | undefined {
  try {
    const { parsed, positionalWords, flagWords } = parseLocated(argv.slice(0, 1), argv.slice(1), commands);
    const positional = positionalWords.find((word, i) => word.value === unknown && (!argument || parsed.spec.args?.[i]?.name === argument));
    if (positional) return { index: positional.index, prefix: "" };
    const flag = flagWords.find(word => !word.secret && (!argument || word.name === argument) && parsed.flags[word.name] === unknown);
    if (flag) return { index: flag.index, prefix: flag.prefix };
  } catch {}
}

function parseWords(words: readonly Word[], spec: CommandSpec, path: string[], original: string[], tree: readonly CommandSpec[], valid = flagsFor(spec)) {
  const flags: Parsed["flags"] = {};
  const positionalWords: Word[] = [];
  const flagWords: { name: string; index: number; prefix: string; secret: boolean }[] = [];
  let options = true;
  const fail: (message: string, suggestions?: string[]) => never = (message, suggestions = []) => { throw usageError(path, message, suggestions, tree); };
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (options && word.value === "--") { options = false; continue; }
    if (!options || !word.value.startsWith("-") || word.value === "-") { positionalWords.push(word); continue; }
    const equals = word.value.indexOf("=");
    const key = equals < 0 ? word.value : word.value.slice(0, equals);
    const flag = valid.find(flag => flag.name === key || flag.short === key);
    if (!flag) {
      const { suggestions, confirmation } = flagSuggestions(spec, original, word, tree, valid);
      fail(`Unknown option ${key} for bedrock ${path.join(" ")}.${confirmation ? ` Use --yes to confirm ${spec.name === "rm" ? "deletion" : "this action"}.` : ""}`, suggestions);
    }
    if (Object.hasOwn(flags, flag.name)) fail(`Repeated option ${key} for bedrock ${path.join(" ")}.`);
    if (!flag.value) {
      if (equals >= 0) fail(`${key} does not take a value.`);
      if (flag.name === "--help") fail(`Use bedrock help ${path.join(" ")} to show help.`);
      flags[flag.name] = true;
      continue;
    }
    const valueWord = equals < 0 ? words[i + 1] : word;
    const value = equals < 0 ? valueWord?.value : word.value.slice(equals + 1);
    if (!value || equals < 0 && !acceptsValue(value, valid)) fail(`${key} needs a value, e.g. ${flag.name} ${flag.value}.`);
    if (flag.choices && !flag.choices.includes(value)) {
      const replacements = suggest(value, flag.choices).map(choice => equals < 0 ? choice : `${key}=${choice}`);
      const display = flag.secret ? flag.value : equals < 0 ? diagnosticWord(original, valueWord!.index, tree) : optionName(value);
      fail(`Invalid value '${display}' for ${key}; choose ${flag.choices.join(", ")}.`, replaySuggestions(original, valueWord!.index, replacements, tree));
    }
    if (equals < 0) i++;
    flags[flag.name] = value;
    flagWords.push({ name: flag.name, index: valueWord!.index, prefix: equals < 0 ? "" : `${key}=`, secret: Boolean(flag.secret) });
  }
  return { positionals: positionalWords.map(word => word.value), flags, positionalWords, flagWords };
}

function flagSuggestions(spec: CommandSpec, original: string[], word: Word, tree: readonly CommandSpec[], valid = flagsFor(spec)) {
  const equals = word.value.indexOf("=");
  const key = word.value.split("=", 1)[0]!;
  const choices = valid.filter(flag => flag.name !== "--help" && (equals < 0 || flag.value));
  const names = choices.flatMap(flag => [flag.name, ...(flag.short ? [flag.short] : [])]);
  const synonyms = Object.fromEntries(choices.flatMap(flag => (flag.suggestFor ?? []).map(word => [word, flag.name])));
  const matches = suggest(key, names, synonyms);
  const confirmation = matches.length === 1 && matches[0] === "--yes";
  if (confirmation) {
    const words = original.filter((_, i) => i !== word.index);
    const boundary = words.indexOf("--");
    const index = boundary < 0 ? words.length : boundary;
    words.splice(index, 0, "--yes");
    return { confirmation, suggestions: replaySuggestions(words, index, ["--yes"], tree) };
  }
  const replacements = matches.map(name => name + (equals < 0 ? "" : word.value.slice(equals)));
  return { confirmation, suggestions: replaySuggestions(original, word.index, replacements, tree) };
}
