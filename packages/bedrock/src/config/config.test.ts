import { expect, test } from "bun:test";
import * as v from "valibot";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { definePebble, query, mutation, bucket, plugin, validateName } from "./index";
import type { FunctionArgs, FunctionResult, QueryNames, MutationNames } from "./index";
import { BedrockError } from "../error";

test.skipIf(process.platform !== "win32")("Windows device names produce repair hints before filesystem writes", () => {
  for (const name of ["con", "nul", "aux", "prn", "com1", "lpt9"]) {
    expect(() => validateName(name)).toThrow("reserved Windows device name");
    expect(() => bucket(name, { maxSize: "1mb", access: "public" })).toThrow("reserved Windows device name");
  }
  expect(() => validateName("console")).not.toThrow();
});

test("validates names, definitions and reserved tables at definition time", () => {
  for (const name of ["", "A", "too_long_name", "a".repeat(33), "auth", "bedrock", "www"]) {
    expect(() => definePebble({ name })).toThrow(BedrockError);
  }
  expect(definePebble({ name: "my-pebble-2" }).name).toBe("my-pebble-2");
  for (const name of ["a/b", "bad-name", "1name", "constructor", "__proto__"]) {
    expect(() => definePebble({ name: "valid", queries: { [name]: query(() => 1) } })).toThrow(BedrockError);
  }
  expect(() => definePebble({ name: "valid", queries: { oops: mutation(() => 1) } })).toThrow(BedrockError);
  expect(() => definePebble({ name: "valid", schema: { reserved: sqliteTable("_bedrock_secret", { id: text("id") }) } })).toThrow(BedrockError);
});

test("Standard Schema overloads and configuration helpers retain inference", () => {
  const pebble = definePebble({
    name: "typed",
    queries: { hello: query(() => ({ greeting: "hi" })) },
    mutations: { add: mutation(v.object({ body: v.string() }), (_ctx, args) => ({ length: args.body.length })) },
  });
  type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
  const names: Equal<QueryNames<typeof pebble>, "hello"> = true;
  const mutationNames: Equal<MutationNames<typeof pebble>, "add"> = true;
  const args: Equal<FunctionArgs<NonNullable<typeof pebble.mutations>["add"]>, { body: string }> = true;
  const output: Equal<FunctionResult<NonNullable<typeof pebble.mutations>["add"]>, { length: number }> = true;
  const noArgs: Equal<FunctionArgs<NonNullable<typeof pebble.queries>["hello"]>, void> = true;
  // @ts-expect-error Arg types must not widen to any.
  const bad: FunctionArgs<NonNullable<typeof pebble.mutations>["add"]> = { body: 123 };
  expect([names, mutationNames, args, output, noArgs]).toEqual([true, true, true, true, true]);
  void bad;
  expect(bucket("attachments", { maxSize: "50mb", access: "owner" }).access).toBe("owner");
  expect(plugin({ name: "audit-log" }).name).toBe("audit-log");
});

test("BedrockError has stable JSON and a repair hint", () => {
  const error = new BedrockError("OOPS", "Something broke", "Try again");
  expect(JSON.parse(JSON.stringify(error))).toEqual({ code: "OOPS", message: "Something broke", hint: "Try again" });
});
