import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { setup } from "../daemon/config";
import { localConfig, localTunnelSetup, parseLocalConfig } from "./local";
import { tunnelStatus } from ".";

for (const output of ["null", "", " \n "]) test(`local tunnel creates and resumes when list returns ${JSON.stringify(output)}`, async () => {
  const temp = tempDirectory();
  const commands: string[][] = [];
  const id = "11111111-1111-1111-1111-111111111111";
  try {
    await setup(temp.dir, "example.com", "creator@example.com", 3000);
    await Bun.write(join(temp.dir, "cloudflared/cert.pem"), "fake cert");
    let listed = output;
    const options = { binary: () => "/fake/cloudflared", host: "test", run: async (args: string[]) => {
      commands.push(args);
      if (args.includes("list")) return listed;
      if (args.includes("create")) {
        const file = args[args.indexOf("--credentials-file") + 1]!;
        expect(file).toBe(join(temp.dir, "cloudflared/credentials.json"));
        await Bun.write(file, JSON.stringify({ TunnelID: id, AccountTag: "fake", TunnelSecret: "fake" }));
        listed = JSON.stringify([{ id, name: "bedrock-test" }]);
        return "Created tunnel bedrock-test";
      }
      return "";
    } };
    for (let i = 0; i < 2; i++) expect(await localTunnelSetup(temp.dir, options)).toMatchObject({ configured: true, tunnelId: id });
    expect(commands.filter(args => args.includes("create"))).toHaveLength(1);
    expect(commands.find(args => args.includes("dns") && !args.includes("--help"))?.slice(-2)).toEqual([id, "*.example.com"]);
  } finally { temp.cleanup(); }
});

for (const output of ["{}", "[null]"]) test(`local tunnel rejects malformed list ${output}`, async () => {
  const temp = tempDirectory();
  try {
    await setup(temp.dir, "example.com", "creator@example.com", 3000);
    await Bun.write(join(temp.dir, "cloudflared/cert.pem"), "fake cert");
    await expect(localTunnelSetup(temp.dir, { binary: () => "/fake/cloudflared", run: async () => output })).rejects.toMatchObject({ code: "CLOUDFLARED_OUTPUT_INVALID" });
  } finally { temp.cleanup(); }
});

test("rerunning local setup keeps extra hostname rules; status reports them and refuses unknown settings", async () => {
  const temp = tempDirectory();
  const id = "11111111-1111-1111-1111-111111111111";
  try {
    await setup(temp.dir, "example.com", "creator@example.com", 3000);
    await Bun.write(join(temp.dir, "cloudflared/cert.pem"), "fake cert");
    await Bun.write(join(temp.dir, "cloudflared/credentials.json"), JSON.stringify({ TunnelID: id }));
    const options = { binary: () => "/fake/cloudflared", host: "test", run: async (args: string[]) => args.includes("list") ? JSON.stringify([{ id, name: "bedrock-test" }]) : "" };
    await localTunnelSetup(temp.dir, options);
    const file = join(temp.dir, "cloudflared/config.yml");
    const generated = await Bun.file(file).text();
    expect(await tunnelStatus(temp.dir)).toMatchObject({ matches: true, tokenStored: true, extraIngress: [], unrecognized: [] });
    // An operator routes a pebble's own port directly, as flamecraft does.
    await Bun.write(file, generated.replace("ingress:\n", 'ingress:\n  - hostname: "game.example.com"\n    service: http://127.0.0.1:7350\n'));
    const status = await tunnelStatus(temp.dir);
    expect(status).toMatchObject({ matches: true, extraIngress: [{ hostname: "game.example.com", service: "http://127.0.0.1:7350" }] });
    await localTunnelSetup(temp.dir, options);
    const kept = await Bun.file(file).text();
    expect(kept).toBe(localConfig("example.com", 3000, id, join(temp.dir, "cloudflared/credentials.json"), [{ hostname: "game.example.com", service: "http://127.0.0.1:7350" }]));
    expect(kept.indexOf("game.example.com")).toBeLessThan(kept.indexOf("*.example.com"));
    await Bun.write(file, kept.replace('    service: "http://127.0.0.1:7350"\n', '    service: "http://127.0.0.1:7350"\n    originRequest:\n      noTLSVerify: true\n'));
    expect((await tunnelStatus(temp.dir) as { unrecognized: string[] }).unrecognized).toEqual(["    originRequest:", "      noTLSVerify: true"]);
    await expect(localTunnelSetup(temp.dir, options)).rejects.toMatchObject({ code: "TUNNEL_CONFIG_CUSTOM" });
    await Bun.write(file, generated.replace("http://127.0.0.1:3000", "http://127.0.0.1:4000"));
    expect(await tunnelStatus(temp.dir)).toMatchObject({ matches: false });
  } finally { temp.cleanup(); }
});

test("setup refuses hand edits it cannot carry over, keeps the file, and still rewrites the wildcard port", async () => {
  const temp = tempDirectory();
  const id = "11111111-1111-1111-1111-111111111111";
  try {
    await setup(temp.dir, "example.com", "creator@example.com", 3000);
    await Bun.write(join(temp.dir, "cloudflared/cert.pem"), "fake cert");
    await Bun.write(join(temp.dir, "cloudflared/credentials.json"), JSON.stringify({ TunnelID: id }));
    const options = { binary: () => "/fake/cloudflared", host: "test", run: async (args: string[]) => args.includes("list") ? JSON.stringify([{ id, name: "bedrock-test" }]) : "" };
    await localTunnelSetup(temp.dir, options);
    const file = join(temp.dir, "cloudflared/config.yml");
    const generated = await Bun.file(file).text();
    const edits = [
      generated.replace("ingress:\n", "ingress:\n  - hostname: 'game.example.com'\n    service: http://127.0.0.1:7350\n"),
      generated.replace("http_status:404", "http_status:403"),
      generated.replace("ingress:\n", 'ingress:\n  - hostname: "*.example.com"\n    service: http://127.0.0.1:8080\n'),
    ];
    for (const [i, edited] of edits.entries()) {
      await Bun.write(file, edited);
      // An unparseable extra rule leaves Bedrock's own rules intact, so doctor warns instead of failing.
      if (i === 0) expect(await tunnelStatus(temp.dir)).toMatchObject({ matches: true, unrecognized: ["  - hostname: 'game.example.com'", "    service: http://127.0.0.1:7350"] });
      else expect(await tunnelStatus(temp.dir)).toMatchObject({ matches: false });
      await expect(localTunnelSetup(temp.dir, options)).rejects.toMatchObject({ code: "TUNNEL_CONFIG_CUSTOM" });
      expect(await Bun.file(file).text()).toBe(edited);
    }
    await Bun.write(file, generated.replace("ingress:\n", 'ingress:\n  - hostname: "game.example.com"\n    service: "unix:/run/game #1.sock"\n'));
    await localTunnelSetup(temp.dir, options);
    expect(parseLocalConfig(await Bun.file(file).text()).rules[0]).toEqual({ hostname: "game.example.com", service: "unix:/run/game #1.sock" });
    // A port change made through setup identity is applied, not treated as a hand edit.
    await Bun.write(file, generated.replace("http://127.0.0.1:3000", "http://127.0.0.1:4000"));
    await localTunnelSetup(temp.dir, options);
    expect(await Bun.file(file).text()).toBe(generated);
  } finally { temp.cleanup(); }
});
