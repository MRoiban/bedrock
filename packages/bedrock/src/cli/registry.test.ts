import { expect, test } from "bun:test";
import { candidatesFor, commandAt, flagsFor, resolveCommand, visibleCommands } from "./registry";
import type { CommandSpec } from "./spec";

const tree: readonly CommandSpec[] = [
  { name: "ls", aliases: ["list-all"], suggestFor: ["list"], summary: "List pebbles", remote: true, flags: [{ name: "--wide", summary: "More columns" }] },
  { name: "alerts", summary: "Manage alerts", defaultSubcommand: "ls", subcommands: [
    { name: "ls", summary: "List alerts" }, { name: "silence", aliases: ["mute"], summary: "Silence alerts" },
  ] },
  { name: "__worker", summary: "Private worker", hidden: true, suggestFor: ["worker"] },
];

test("resolve leading paths, aliases and defaults without consuming positional words", () => {
  expect(resolveCommand(["list-all", "notes"], tree)).toMatchObject({ path: ["ls"], consumed: 1 });
  expect(resolveCommand(["alerts", "mute", "incident"], tree)).toMatchObject({ path: ["alerts", "silence"], consumed: 2 });
  for (const words of [["alerts"], ["alerts", "notes"], ["alerts", "--json"]]) {
    expect(resolveCommand(words, tree)).toMatchObject({ path: ["alerts", "ls"], consumed: 1 });
  }
  expect(resolveCommand(["alerts"], tree, false)?.path).toEqual(["alerts"]);
  expect(resolveCommand(["unknown"], tree)).toBeUndefined();
});

test("hidden commands can run but never appear in visible names or synonyms", () => {
  expect(commandAt("__worker", tree)?.hidden).toBe(true);
  expect(resolveCommand(["__worker"], tree)?.path).toEqual(["__worker"]);
  expect(visibleCommands(tree).map(spec => spec.name)).toEqual(["ls", "alerts"]);
  expect(candidatesFor(tree)).toEqual({ names: ["ls", "list-all", "alerts"], synonyms: { list: "ls" } });
});

test("flags are ordered command, remote, global, with no duplicates", () => {
  expect(flagsFor(tree[0]!).map(flag => flag.name)).toEqual(["--wide", "--url", "--token", "--json", "--help"]);
  expect(flagsFor(tree[1]!).map(flag => flag.name)).toEqual(["--json", "--help"]);
  expect(flagsFor({ name: "x", summary: "x", remote: true, flags: [{ name: "--url", summary: "Custom URL" }] }).filter(flag => flag.name === "--url")).toHaveLength(1);
});

test("mixed command suggestion ties omit destructive matches", async () => {
  const { commands } = await import("./commands");
  const { suggestCommands } = await import("./registry");
  for (const typo of ["lm", "rs"]) expect(suggestCommands(typo, commands)).toEqual(["ls"]);
  expect(suggestCommands("ps", commands)).toEqual(["ls"]);
  expect(suggestCommands("remove", commands)).toEqual(["rm"]);
  expect(suggestCommands("rest", [{ name: "restore", summary: "Restore", destructive: true }])).toEqual(["restore"]);
  for (const path of [["rm"], ["tunnel", "teardown"], ["backup", "restore"], ["token", "revoke"], ["pebble-token", "revoke"], ["errors", "merge"], ["secrets", "unset"], ["service", "uninstall"]]) {
    expect(resolveCommand(path, commands, false)?.spec.destructive).toBe(true);
  }
});
