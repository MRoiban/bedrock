import { expect, test } from "bun:test";
import { remoteSelfUpdate } from "./update";

test("remote update pins logged-in credentials and waits for the new boot and commit", async () => {
  let time = 0;
  let polls = 0;
  const methods: string[] = [];
  const result = await remoteSelfUpdate({ credentials: async () => ({ url: "https://bedrock.example.test", token: "fake", email: "creator@example.test" }), now: () => time, sleep: async ms => { time += ms; }, fetch: (async (url, init) => {
    expect(new URL(String(url)).origin).toBe("https://bedrock.example.test");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fake");
    methods.push(init!.method!);
    if (init?.method === "POST") return Response.json({ ok: true, value: { from: "a".repeat(40), to: "b".repeat(40), updated: true, output: "done" } });
    polls++;
    if (polls === 2) throw new Error("restarting");
    return Response.json({ ok: true, value: { instanceId: polls < 4 ? "old" : "new", commit: polls < 4 ? "a".repeat(40) : "b".repeat(40), domain: "example.test" } });
  }) as typeof fetch });
  expect(result).toMatchObject({ remote: true, domain: "example.test", seconds: 5 });
  expect(methods.filter(method => method === "POST")).toHaveLength(1);
});
test("unchanged commits require a new daemon boot and timeout if it never restarts", async () => {
  let time = 0;
  await expect(remoteSelfUpdate({ credentials: async () => ({ url: "https://bedrock.example.test", token: "fake" }), timeout: 4000, now: () => time, sleep: async ms => { time += ms; }, fetch: (async (_, init) => Response.json({ ok: true, value: init?.method === "POST" ? { from: "same", to: "same", updated: false } : { commit: "same", instanceId: "old" } })) as typeof fetch })).rejects.toMatchObject({ code: "UPDATE_RESTART_TIMEOUT" });
});
test("remote update requires login and surfaces daemon errors", async () => {
  await expect(remoteSelfUpdate({ credentials: async () => null })).rejects.toMatchObject({ code: "TOKEN_MISSING" });
  await expect(remoteSelfUpdate({ credentials: async () => ({ url: "https://bedrock.example.test", token: "fake" }), fetch: (async (_url: string | URL | Request) => Response.json({ ok: false, error: { code: "CHECKOUT_DIRTY", message: "dirty", hint: "clean up" } }, { status: 409 })) as typeof fetch })).rejects.toMatchObject({ code: "CHECKOUT_DIRTY" });
});
