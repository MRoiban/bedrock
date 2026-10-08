import { expect, test } from "bun:test";
import { tempDirectory } from "../../test/helpers";
import { openDatabase } from "../db";
import { definePebble, query } from "../config";
import { createExecutor } from "./functions";
import { handleServiceToken } from "./service-tokens";

test("IPC service token creation waits for the executor and shares token permission validation", async () => {
  const temp = tempDirectory(); const database = openDatabase(temp.dir, {}, true);
  const execute = createExecutor(definePebble({ name: "service", tokens: true, queries: { who: query(ctx => ctx.user) } }), database);
  const user = { id: "creator", email: "creator@example.test", name: "Creator" };
  try {
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = execute.job(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); });
    await started; let finished = false;
    const pending = handleServiceToken(execute, { requestId: "create", user, input: { name: "service", permissions: ["query:who"] } }).then(value => { finished = true; return value; });
    await Bun.sleep(1); expect(finished).toBe(false); release(); await held;
    const result = await pending; expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({ id: expect.any(String), token: expect.stringMatching(/^brk_/) });
    const invalid = await handleServiceToken(execute, { requestId: "bad", user, input: { name: "bad", permissions: ["query:missing"] } });
    expect(invalid.error?.code).toBe("INVALID_TOKEN_PERMISSION");
    expect((await execute("query", "inspect", null, new Request("http://localhost"), { user }, ctx => ctx.tokens.list())).value).toHaveLength(1);
  } finally { await execute.close(); database.close(); temp.cleanup(); }
});
