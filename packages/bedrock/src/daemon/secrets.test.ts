import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { createSecrets } from "./secrets";
import { PebbleLogs } from "./logs";

test("secret updates validate before writing, redact metadata, and never expose corrupt file contents", async () => {
  const temp = tempDirectory(); const secrets = createSecrets(temp.dir);
  try {
    expect(await secrets.list("new")).toEqual({ secrets: [] });
    const secret = "sensitive-value";
    await secrets.update("new", { set: { DISCORD_TOKEN: secret } });
    for (const input of [null, [], { extra: secret }, { set: [] }, { set: { DISCORD_TOKEN: 1 } }, { set: { TOKEN: "bad\0value" } }, { unset: [1] }, { restart: "true" }, { set: { OK: secret, BEDROCK_BAD: secret } }])
      await expect(secrets.update("new", input)).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(await secrets.env("new")).toEqual({ DISCORD_TOKEN: secret });
    expect(JSON.stringify(await secrets.list("new"))).not.toContain(secret);
    await secrets.update("new", { unset: ["DISCORD_TOKEN"] }); expect(await secrets.env("new")).toEqual({});
    await Bun.write(join(temp.dir, "pebbles/new/secrets.json"), secret);
    await expect(secrets.list("new")).rejects.toMatchObject({ code: "SECRETS_READ_FAILED", message: "Could not read pebble secrets." });
  } finally { temp.cleanup(); }
});

test("log lines are timestamped whole lines and short secrets are not redacted", async () => {
  const temp = tempDirectory();
  try {
    const logs = new PebbleLogs(temp.dir, "sample"); logs.protect(["300", "long-secret-value"]);
    const chunks = ["one\ntw", "o long-secret-value\npartial", " 300 end"];
    await logs.pump(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }));
    const lines = (await Bun.file(logs.path).text()).split("\n");
    expect(lines.map(line => line.replace(/^\S+Z /, ""))).toEqual(["one", "two [REDACTED]", "partial 300 end"]);
    expect(lines.every(line => /^\d{4}-\d\d-\d\dT[\d:.]+Z /.test(line))).toBe(true);
    const raw = new PebbleLogs(temp.dir, "", 1024, join(temp.dir, "raw"), "raw.log", false);
    raw.write(new TextEncoder().encode("as is\n"));
    expect(await Bun.file(raw.path).text()).toBe("as is\n");
  } finally { temp.cleanup(); }
});

test("secret redaction spans UTF-8 and pipe boundaries, including JSON escaping", async () => {
  const temp = tempDirectory();
  try {
    const logs = new PebbleLogs(temp.dir, "sample"); const secret = 'private-é-"value'; logs.protect([secret]);
    const encoded = new TextEncoder().encode(`before ${secret} after ${JSON.stringify(secret)}\n`);
    await logs.pump(new ReadableStream({ start(controller) { for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
    const stored = await Bun.file(logs.path).text();
    expect(stored).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z before \[REDACTED\] after "\[REDACTED\]"\n$/);
    expect(await (await logs.response(false, new AbortController().signal)).text()).toBe(stored);
  } finally { temp.cleanup(); }
});
