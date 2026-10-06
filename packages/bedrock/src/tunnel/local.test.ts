import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { setup } from "../daemon/config";
import { localTunnelSetup } from "./local";

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
