import { describe, expect, test } from "bun:test";
import { suggest, typoDistance } from "./suggest";

const commands = ["new", "init", "dev", "test", "db", "deploy", "ls", "status", "start", "stop", "restart", "rollback", "rm", "jobs",
  "logs", "metrics", "errors", "alerts", "login", "logout", "whoami", "token", "pebble-token", "session", "secrets",
  "setup", "daemon", "service", "tunnel", "doctor", "backup", "data", "self-update", "help", "version", "completion"];

describe("typoDistance", () => {
  test("weights typing errors like git", () => {
    expect(typoDistance("sttaus", "status")).toBe(0); // swapped letters are free
    expect(typoDistance("error", "errors")).toBe(1); // a missing letter is cheap
    expect(typoDistance("deploi", "deploy")).toBe(2); // a wrong letter costs more
    expect(typoDistance("tokens", "token")).toBe(3); // an extra letter costs most
  });
});

describe("suggest", () => {
  test.each([
    ["error", ["errors"]], ["deploi", ["deploy"]], ["sttaus", ["status"]], ["delpoy", ["deploy"]],
    ["log", ["logs"]], ["metric", ["metrics"]], ["tunel", ["tunnel"]], ["dcotor", ["doctor"]],
    ["whoaim", ["whoami"]], ["bakcup", ["backup"]], ["selfupdate", ["self-update"]], ["Deploy", ["deploy"]],
  ])("%s → %p", (typed, expected) => expect(suggest(typed, commands)).toEqual(expected));

  test("prefixes rank first and ties are all shown", () => {
    expect(suggest("sta", commands)).toEqual(["status", "start"]);
    expect(suggest("lo", commands)).toEqual(["logs", "login", "logout"]);
  });

  test("unrelated words get no suggestion", () => {
    for (const typed of ["x", "foo", "kubernetes", "zzzz", ""]) expect(suggest(typed, commands)).toEqual([]);
  });

  test("synonyms reach words no typo explains", () => {
    expect(suggest("list", commands, { list: "ls", remove: "rm" })).toEqual(["ls"]);
    expect(suggest("remove", commands, { list: "ls", remove: "rm" })).toEqual(["rm"]);
  });

  test("flags and choices", () => {
    expect(suggest("--frce", ["--force", "--url", "--token"])).toEqual(["--force"]);
    expect(suggest("--no-opn", ["--no-open", "--url", "--token"])).toEqual(["--no-open"]);
    expect(suggest("phnoe", ["desktop", "phone"])).toEqual(["phone"]);
  });

  test("an exact match is not a suggestion", () => {
    expect(suggest("deploy", commands)).toEqual([]);
  });
});

test("typos in synonyms map to canonical candidates and deduplicate ties", () => {
  expect(suggest("lsit", ["ls", "run", "history"], { list: "ls" })).toEqual(["ls"]);
  expect(suggest("remvoe", ["ls", "rm"], { remove: "rm" })).toEqual(["rm"]);
  expect(suggest("lis", ["ls"], { list: "ls", lists: "ls" })).toEqual(["ls"]);
  expect(suggest("list", ["ls"], { list: "missing" })).toEqual([]);
});
