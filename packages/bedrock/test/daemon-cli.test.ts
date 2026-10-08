import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { setup } from "../src/daemon/config";
import { startDaemon } from "../src/daemon";
import { tempDirectory } from "./helpers";

const cli = resolve(import.meta.dir, "../src/cli/index.ts");
test("daemon CLI uses local credentials, honors explicit flags, and reports one JSON object", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "home");
  const env = { ...process.env, BEDROCK_HOME: home, BEDROCK_URL: undefined, BEDROCK_TOKEN: undefined };
  const command = async (args: string[], override = {}) => {
    const child = Bun.spawn([process.execPath, cli, ...args, "--json"], { cwd: resolve(import.meta.dir, "../../.."), env: { ...env, ...override }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim().split("\n")).toHaveLength(1);
    return { code, value: JSON.parse(stdout) };
  };
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  try {
    expect((await setup(home, "localhost", undefined, 0)).created).toBe(true);
    expect((await setup(home, "other.test")).created).toBe(false);
    daemon = await startDaemon({ home });
    expect((await command(["deploy", "examples/notes"])).code).toBe(0);
    expect((await command(["ls"])).value.value[0].name).toBe("notes");
    expect((await command(["status"])).value.pebbles[0].url).toStartWith("http://notes.localhost:");
    expect((await command(["whoami"])).value.user).toBe("server creator token");
    const token = (await Bun.file(join(home, "admin-token")).text()).trim();
    const url = `http://bedrock.localhost:${daemon.server.port}`;
    expect((await command(["ls", "--url", url, "--token", token], { BEDROCK_URL: "http://127.0.0.1:1", BEDROCK_TOKEN: "bad" })).code).toBe(0);
    expect((await command(["ls"], { BEDROCK_TOKEN: "bad" })).value.error.code).toBe("UNAUTHORIZED");
    expect(typeof (await command(["logs", "notes"])).value.logs).toBe("string");
    for (const action of ["stop", "start", "restart"]) expect((await command([action, "notes"])).code).toBe(0);
    expect((await command(["rollback", "notes"])).value.error.code).toBe("NO_PREVIOUS_RELEASE");
    expect((await command(["deploy", "examples/notes"])).code).toBe(0);
    expect((await command(["rollback", "notes"])).code).toBe(0);
    expect((await command(["token", "create"])).value.value.token).toStartWith("br_");
    const scoped = await command(["token", "create", "--name", "manager", "--pebbles", "notes,bot-*", "--actions", "deploy,lifecycle,logs,secrets,status,service-tokens"]);
    expect(scoped.code).toBe(0);
    const scopes = (await command(["token", "ls"])).value.value;
    expect(scopes.find((row: { name: string }) => row.name === "manager").scope).toEqual({ pebbles: ["notes", "bot-*"], actions: ["deploy", "lifecycle", "logs", "secrets", "status", "service-tokens"] });
    expect((await command(["token", "create", "--pebbles", "notes"])).value.error.code).toBe("INVALID_ARGS");
    expect((await command(["secrets", "ls", "notes"], { BEDROCK_TOKEN: scoped.value.value.token })).value.secrets).toEqual([]);
    expect((await command(["rm", "notes"])).value.error.code).toBe("CONFIRM_REQUIRED");
    expect((await command(["rm", "notes", "--yes"])).code).toBe(0);
    expect((await command(["rm", "notes", "--yes"])).value.value.deleted).toBe(false);
    expect((await command(["ls"])).value.value).toEqual([]);
  } finally { await daemon?.stop(); temp.cleanup(); }
}, 30000);
