import { chmod } from "node:fs/promises";
import { BedrockError } from "./error";

let userSid: string | undefined;
export async function privateFile(path: string) {
  if (process.platform !== "win32") { await chmod(path, 0o600); return; }
  try {
    if (!userSid) {
      const who = Bun.spawn(["whoami.exe", "/user", "/fo", "csv", "/nh"], { stdout: "pipe", stderr: "ignore" });
      const output = await new Response(who.stdout).text();
      if (await who.exited !== 0) throw new Error();
      userSid = /S-1-[\d-]+/.exec(output)?.[0];
      if (!userSid) throw new Error();
    }
    // POSIX modes do not restrict access on NTFS; grant only the owner and SYSTEM.
    const child = Bun.spawn(["icacls.exe", path, "/inheritance:r", "/grant:r", `*${userSid}:(F)`, "*S-1-5-18:(F)"], { stdout: "ignore", stderr: "ignore" });
    if (await child.exited !== 0) throw new Error();
  } catch { throw new BedrockError("PRIVATE_FILE_FAILED", "Could not restrict access to a private Bedrock file.", "Use an NTFS directory owned by your Windows user and check icacls permissions."); }
}
