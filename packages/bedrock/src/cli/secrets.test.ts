import { expect, test } from "bun:test";
import { secretsCommand } from "./secrets";
import type { call } from "./daemon";

test("secrets CLI keeps values off argv and responses; stdin and hidden prompts send exact values", async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const request: typeof call = async (_flags, path, init = {}) => { calls.push({ path, init }); return Response.json({ ok: true, value: { secrets: [{ name: "DISCORD_TOKEN", updatedAt: 1 }] } }); };
  const value = "a secret\n";
  const result = await secretsCommand(["set", "upty", "DISCORD_TOKEN", "--restart"], { tty: false, stdin: async () => value, request });
  expect(result).toEqual({ command: "secrets set", secrets: [{ name: "DISCORD_TOKEN", updatedAt: 1 }] });
  expect(JSON.stringify(result)).not.toContain(value);
  expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ set: { DISCORD_TOKEN: value }, restart: true });
  await secretsCommand(["set", "upty", "DISCORD_TOKEN"], { tty: true, prompt: async () => "prompted", request });
  expect(JSON.parse(calls[1]!.init.body as string).set.DISCORD_TOKEN).toBe("prompted");
  expect(await secretsCommand(["unset", "upty", "DISCORD_TOKEN", "OTHER"], { request })).toEqual({ command: "secrets unset", secrets: [{ name: "DISCORD_TOKEN", updatedAt: 1 }] });
  expect(JSON.parse(calls[2]!.init.body as string)).toEqual({ unset: ["DISCORD_TOKEN", "OTHER"] });
  expect(await secretsCommand(["ls", "upty"], { request })).toEqual({ command: "secrets ls", secrets: [{ name: "DISCORD_TOKEN", updatedAt: 1 }] });
  expect(calls[3]!.init.body).toBeUndefined();
  for (const args of [["set", "upty", "DISCORD_TOKEN", "secret-in-argv"], ["set", "upty", "BEDROCK_API_URL"], ["ls", "upty", "--restart"]])
    await expect(secretsCommand(args, { request })).rejects.toMatchObject({ code: "INVALID_ARGS" });
});

test("secrets CLI reads bare metadata from daemons that predate the unified envelope", async () => {
  const request: typeof call = async () => Response.json({ secrets: [{ name: "DISCORD_TOKEN", updatedAt: 1 }] });
  expect(await secretsCommand(["ls", "upty"], { request })).toEqual({ command: "secrets ls", secrets: [{ name: "DISCORD_TOKEN", updatedAt: 1 }] });
});
