import { test, expect } from "bun:test";
import { definePebble, query, mutation } from "../config";
import * as v from "valibot";
import { useQuery, useMutation } from "../react";
import { createClient } from "./index";

const pebble = definePebble({ name: "types", queries: { date: query(() => new Date()), transformed: query(v.pipe(v.string(), v.transform(Number)), (_ctx, value) => value), count: query(v.object({ offset: v.number() }), (_ctx, args) => args.offset + 1) }, mutations: { title: mutation(v.string(), (_ctx, title) => ({ title })) } });
// Compile-only checks: no network requests should escape this function.
function inference() {
  const client = createClient<typeof pebble>({ url: "http://localhost" });
  const date: Promise<string> = client.query("date", undefined);
  const transformed: Promise<number> = client.query("transformed", "2");
  // @ts-expect-error Client sends the schema input, not its transformed output.
  client.query("transformed", 2);
  const count: Promise<number> = client.query("count", { offset: 2 });
  const title: Promise<{ title: string }> = client.mutate("title", "hello");
  client.subscribe("count", { offset: 2 }, value => { const number: number = value; void number; });
  // @ts-expect-error unknown query name
  client.query("missing", { offset: 2 });
  // @ts-expect-error wrong query arguments
  client.query("count", { offset: "two" });
  // @ts-expect-error wrong mutation arguments
  client.mutate("title", 1);
  // @ts-expect-error wrong result type
  const wrong: Promise<string> = client.query("count", { offset: 1 });
  void [count, title, wrong, date, transformed];
}
function hookInference() {
  const query = useQuery<typeof pebble, "count">("count", { offset: 1 });
  const data: number | undefined = query.data;
  const mutation = useMutation<typeof pebble, "title">("title");
  const result: Promise<{ title: string }> = mutation.mutate("title");
  // @ts-expect-error hook mutation input remains typed
  mutation.mutate(2);
  void [data, result];
}
test("client inference checks compile without importing server code at runtime", async () => {
  void [inference, hookInference];
  const build = await Bun.build({ entrypoints: [import.meta.dir + "/index.ts"], target: "browser" });
  expect(build.success).toBe(true);
  const output = await build.outputs[0]!.text();
  expect(output).not.toContain("bun:sqlite");
  expect(output).not.toContain("async_hooks");
});
