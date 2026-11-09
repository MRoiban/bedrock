import { describe, expect, test } from "bun:test";
import { commands } from "./commands";
import { globalFlags, remoteFlags, type CommandSpec } from "./spec";

const authorGuide = await Bun.file(new URL("../../AGENTS.md", import.meta.url)).text();
const reference = await Bun.file(new URL("../../../../docs/reference.md", import.meta.url)).text();

function entries(specs: readonly CommandSpec[], parent: string[] = []): { spec: CommandSpec; path: string[] }[] {
  return specs.flatMap(spec => {
    const path = [...parent, spec.name];
    return [{ spec, path }, ...entries(spec.subcommands ?? [], path)];
  });
}

function headingSlugs(markdown: string) {
  const slugs = new Set<string>();
  let fence = "";
  for (const line of markdown.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]?.[0];
    if (marker) { if (!fence) fence = marker; else if (fence === marker) fence = ""; continue; }
    if (fence) continue;
    const heading = /^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line)?.[1];
    if (!heading) continue;
    const base = heading.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").replaceAll(" ", "-");
    let slug = base;
    for (let suffix = 1; slugs.has(slug); suffix++) slug = `${base}-${suffix}`;
    slugs.add(slug);
  }
  return slugs;
}

function examplePath(run: string) {
  const words = run.split(/\s+/).slice(1);
  let siblings = commands;
  const path: string[] = [];
  let fallback: string | undefined;
  while (siblings.length) {
    const explicit = siblings.find(spec => spec.name === words[0] || spec.aliases?.includes(words[0]!));
    const spec = explicit ?? siblings.find(spec => spec.name === fallback);
    if (!spec) return undefined;
    if (explicit) words.shift();
    path.push(spec.name);
    siblings = spec.subcommands ?? [];
    fallback = spec.defaultSubcommand;
  }
  return path;
}

const all = entries(commands);
const visible = commands.filter(spec => !spec.hidden);

describe("CLI command registry", () => {
  test("names, aliases and suggestion words are unique at each level", () => {
    const levels = [commands, ...all.map(({ spec }) => spec.subcommands ?? [])];
    for (const specs of levels) {
      const spellings = specs.flatMap(spec => [spec.name, ...(spec.aliases ?? []), ...(spec.suggestFor ?? [])]);
      expect(new Set(spellings).size, `duplicate spelling among ${specs.map(spec => spec.name).join(", ")}`).toBe(spellings.length);
      for (const word of spellings) expect(word).toMatch(/^\S+$/);
    }
  });

  test("every visible top-level command has a workflow group", () => {
    for (const spec of visible) expect(["build", "ship", "observe", "access", "server", "cli"], spec.name).toContain(spec.group!);
  });

  test("summaries are short, single-line sentences without a trailing period", () => {
    for (const { spec, path } of all) {
      for (const summary of [spec.summary, ...(spec.flags ?? []).map(flag => flag.summary)]) {
        expect(summary.length, path.join(" ")).toBeGreaterThan(0);
        expect(summary.length, path.join(" ")).toBeLessThanOrEqual(72);
        expect(summary).not.toMatch(/[\r\n]|\.$/);
        expect(summary).toMatch(/^[A-Z]/);
      }
      if (!spec.hidden) expect(spec.description, path.join(" ")).toBeTruthy();
    }
  });

  test("required arguments precede optional arguments and variadics are last", () => {
    for (const { spec, path } of all) {
      let optional = false;
      const args = spec.args ?? [];
      expect(new Set(args.map(arg => arg.name)).size, path.join(" ")).toBe(args.length);
      for (const [index, arg] of args.entries()) {
        if (arg.required) expect(optional, `${path.join(" ")} <${arg.name}> follows an optional argument`).toBe(false);
        else optional = true;
        if (arg.variadic) expect(index, path.join(" ")).toBe(args.length - 1);
        if (arg.choices) {
          expect(arg.choices.length).toBeGreaterThan(0);
          expect(new Set(arg.choices).size).toBe(arg.choices.length);
        }
      }
    }
  });

  test("default subcommands exist at the correct level", () => {
    for (const { spec, path } of all) {
      if (spec.defaultSubcommand) expect(spec.subcommands?.map(child => child.name), path.join(" ")).toContain(spec.defaultSubcommand);
    }
  });

  test("long and short flags are unique alongside global and remote flags", () => {
    for (const { spec, path } of all) {
      const flags = [...globalFlags, ...(spec.remote ? remoteFlags : []), ...(spec.flags ?? [])];
      const spellings = flags.flatMap(flag => [flag.name, ...(flag.short ? [flag.short] : [])]);
      expect(new Set(spellings).size, path.join(" ")).toBe(spellings.length);
      for (const flag of flags) {
        expect(flag.name).toMatch(/^--[a-z][a-z0-9-]*$/);
        if (flag.short) expect(flag.short).toMatch(/^-[a-z]$/);
        if (flag.value) expect(flag.value).toMatch(/^<[^<>]+>$/);
        if (flag.choices) {
          expect(flag.value).toBeTruthy();
          expect(flag.choices.length).toBeGreaterThan(0);
          expect(new Set(flag.choices).size).toBe(flag.choices.length);
        }
        if (flag.secret) expect(flag.value).toBeTruthy();
      }
    }
  });

  test("guide links point to existing headings outside code blocks", () => {
    const headings = headingSlugs(authorGuide);
    for (const { spec, path } of all) {
      if (!spec.hidden) expect(spec.docs?.length, path.join(" ")).toBeGreaterThan(0);
      for (const doc of spec.docs ?? []) {
        expect(doc).toMatch(/^AGENTS\.md#[a-z0-9_-]+$/);
        expect(headings.has(doc.slice("AGENTS.md#".length)), `missing guide anchor ${doc}`).toBe(true);
      }
    }
  });

  test("examples resolve through real command paths, including defaults", () => {
    for (const { spec, path } of all) {
      if (!spec.hidden && (spec.args?.length || spec.flags?.length || spec.subcommands?.length)) {
        expect(spec.examples?.length, path.join(" ")).toBeGreaterThan(0);
      }
      for (const example of spec.examples ?? []) {
        expect(example.run.startsWith("bedrock ")).toBe(true);
        const resolved = examplePath(example.run);
        expect(resolved, `unresolved command in ${example.run}`).toBeDefined();
        expect(resolved?.slice(0, path.length), `example is for a different command: ${example.run}`).toEqual(path);
      }
    }
  });

  // New CLI command names must be explicit: ordinary prose also says "completion" and "help".
  const documented = (text: string, spec: CommandSpec) => spec.group === "cli"
    ? new RegExp(`\\bbedrock\\s+${spec.name}\\b`).test(text)
    : new RegExp(`\\b${spec.name}\\b`).test(text);

  for (const [file, text] of [["docs/reference.md", reference], ["packages/bedrock/AGENTS.md", authorGuide]] as const) {
    test(`visible command names appear in ${file}`, () => {
      for (const spec of visible) {
        expect(documented(text, spec), `${file} missing command ${spec.name}`).toBe(true);
      }
    });
  }
});
