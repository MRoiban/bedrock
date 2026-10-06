import { expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { tempDirectory } from "../../test/helpers";
import { setup } from "./config";
import { openDaemonDatabase, tokenHash } from "./db";
import { hostTarget } from "./proxy";
import { PebbleLogs } from "./logs";
import { extract, run } from "./archive";

test("setup is idempotent and daemon migrations/tokens support later schema extensions", async () => {
  const temp = tempDirectory();
  try {
    expect((await setup(temp.dir, "localhost", "one@example.test", 0)).created).toBe(true);
    const repeated = await setup(temp.dir, "other.test", "two@example.test", 12);
    expect(repeated.created).toBe(false);
    expect(repeated.config.domain).toBe("localhost");
    const first = await openDaemonDatabase(temp.dir);
    const token = first.createToken();
    expect(first.accepts(token)).toBe(true);
    expect(first.accepts("wrong")).toBe(false);
    expect(first.db.query("SELECT hash FROM deploy_tokens").get()).toEqual({ hash: tokenHash(token) });
    first.close();
    const second = await openDaemonDatabase(temp.dir);
    expect(second.accepts(token)).toBe(true);
    expect(second.db.query("SELECT name FROM _bedrock_migrations").all()).toHaveLength(3);
    second.close();
  } finally { temp.cleanup(); }
});

test("host router uses exact single-label subdomains", () => {
  expect(hostTarget("SAMPLE.EXAMPLE.TEST:3000", "example.test")).toBe("sample");
  expect(hostTarget("sample.localhost", "example.test")).toBe("sample");
  for (const host of ["example.test", "evil-example.test", "x.y.example.test", "localhost", "[::1]:3000"]) expect(hostTarget(host, "example.test")).toBeNull();
});

test("logs rotate at their size limit and keep three older files", async () => {
  const temp = tempDirectory();
  try {
    const logs = new PebbleLogs(temp.dir, "sample", 5);
    for (const part of ["aaaaa", "bbbbb", "ccccc", "ddddd", "eeeee"]) logs.write(new TextEncoder().encode(part));
    expect(readFileSync(logs.path, "utf8")).toBe("eeeee");
    expect(readFileSync(`${logs.path}.3`, "utf8")).toBe("bbbbb");
    expect(await Bun.file(`${logs.path}.4`).exists()).toBe(false);
  } finally { temp.cleanup(); }
});

test("deploy extraction rejects archive links before touching release files", async () => {
  const temp = tempDirectory();
  try {
    // Build a tar link directly; Windows junctions are archived as directories.
    const header = Buffer.alloc(512);
    header.write("escape");
    for (const offset of [100, 108, 116]) header.write("0000777\0", offset);
    for (const offset of [124, 136]) header.write("00000000000\0", offset);
    header.fill(32, 148, 156);
    header.write("2", 156);
    header.write("/outside", 157);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
    const archive = join(temp.dir, "bad.tar.gz");
    await Bun.write(archive, Bun.gzipSync(Buffer.concat([header, Buffer.alloc(1024)])));
    await expect(extract(archive, join(temp.dir, "release"))).rejects.toMatchObject({ code: "UNSAFE_ARCHIVE" });
  } finally { temp.cleanup(); }
});

test("setup adds and updates Google credentials idempotently without losing existing configuration", async () => {
  const temp = tempDirectory();
  try {
    await setup(temp.dir, "example.test", "creator@example.test", 1234);
    const google = { clientId: "client", clientSecret: "secret" };
    const updated = await setup(temp.dir, "example.test", undefined, 3000, google);
    expect(updated.created).toBe(false);
    expect(updated.config).toMatchObject({ creators: ["creator@example.test"], port: 1234, google });
    expect((await setup(temp.dir, "example.test", undefined, 3000, google)).config).toEqual(updated.config);
    expect((await setup(temp.dir, "example.test", undefined, 3000, { ...google, clientSecret: "new-secret" })).config.google?.clientSecret).toBe("new-secret");
  } finally { temp.cleanup(); }
});
