import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../test/helpers";
import { atomicWrite } from "./daemon/config";

test.skipIf(process.platform !== "win32")("private writes replace inherited ACLs and remain readable after replacement", async () => {
  const temp = tempDirectory();
  const path = join(temp.dir, "secret with spaces.json");
  try {
    for (const secret of ["first", "replacement"]) {
      await atomicWrite(path, secret);
      expect(await Bun.file(path).text()).toBe(secret);
      const child = Bun.spawn(["icacls.exe", path], { stdout: "pipe", stderr: "pipe" });
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      expect(output).not.toContain("(I)");
      expect(output).toContain("(F)");
      const script = `$acl = Get-Acl -LiteralPath '${path.replaceAll("'", "''")}'; $acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }`;
      const acl = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { stdout: "pipe", stderr: "pipe" });
      const sids = (await new Response(acl.stdout).text()).trim().split(/\r?\n/);
      expect(await acl.exited).toBe(0);
      expect(sids).toHaveLength(2);
      expect(sids).toContain("S-1-5-18");
    }
  } finally { temp.cleanup(); }
});
