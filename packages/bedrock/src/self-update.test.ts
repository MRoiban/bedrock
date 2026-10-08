import { expect, test } from "bun:test";
import { tempDirectory } from "../test/helpers";
import { updateCheckout, redactOutput, updateRun } from "./self-update";
import { buildInfo } from "./version";

for (const platform of ["darwin", "linux", "win32"] as const) {
  test(`checkout update uses git and the running Bun on ${platform}`, async () => {
    const temp = tempDirectory();
    const calls: string[][] = [];
    let commit = "a".repeat(40);
    try {
      const execute: typeof updateRun = async (args, options) => {
        calls.push(args);
        if (args.includes("--show-toplevel")) return temp.dir;
        if (args.includes("rev-parse")) return commit;
        if (args.includes("symbolic-ref")) return "main";
        if (args.includes("status")) return "";
        expect(options?.cwd).toBe(temp.dir);
        if (args.includes("pull")) { commit = "b".repeat(40); return "Updated https://user:password@example.com/repo br_abcdef"; }
        return "installed";
      };
      const result = await updateCheckout({ checkout: temp.dir, run: execute, platform });
      expect(result).toMatchObject({ from: "a".repeat(40), to: "b".repeat(40), updated: true });
      expect(result.output).not.toContain("password");
      expect(result.output).not.toContain("br_abcdef");
      expect(calls).toContainEqual([platform === "win32" ? "git.exe" : "git", "pull", "--ff-only"]);
      expect(calls).toContainEqual([process.execPath, "install"]);
    } finally { temp.cleanup(); }
  });
}
test("non-checkouts report null git fields and cannot update", async () => {
  const run = async () => { throw new Error("not a checkout"); };
  expect(await buildInfo("/fake", run)).toMatchObject({ commit: null, branch: null, dirty: null });
  expect(updateCheckout({ checkout: "/fake", run })).rejects.toMatchObject({ code: "CHECKOUT_REQUIRED" });
});
test("dirty and divergent checkouts are refused without installing dependencies", async () => {
  const temp = tempDirectory();
  try {
    for (const dirty of [true, false]) {
      const run: typeof updateRun = async args => {
        if (args.includes("--show-toplevel")) return temp.dir;
        if (args.includes("rev-parse")) return "a".repeat(40);
        if (args.includes("symbolic-ref")) return "main";
        if (args.includes("status")) return dirty ? "?? file" : "";
        if (args.includes("pull")) throw new Error("Not possible to fast-forward");
        throw new Error("must not install");
      };
      expect(updateCheckout({ checkout: temp.dir, run })).rejects.toMatchObject({ code: dirty ? "CHECKOUT_DIRTY" : "UPDATE_PULL_FAILED" });
    }
  } finally { temp.cleanup(); }
});
test("up-to-date checkouts still install dependencies and report updated false", async () => {
  const temp = tempDirectory();
  let installed = false;
  try {
    const run: typeof updateRun = async args => {
      if (args.includes("--show-toplevel")) return temp.dir;
      if (args.includes("rev-parse")) return "a".repeat(40);
      if (args.includes("symbolic-ref")) return "main";
      if (args.includes("install")) installed = true;
      return "";
    };
    expect(await updateCheckout({ checkout: temp.dir, run })).toMatchObject({ updated: false });
    expect(installed).toBe(true);
  } finally { temp.cleanup(); }
});
test("runner returns both output streams and redacts failed command output", async () => {
  expect(await updateRun([process.execPath, "-e", 'console.log("out"); console.error("err")'])).toContain("err");
  await expect(updateRun([process.execPath, "-e", 'console.error("https://user:pass@example.com/?token=hidden brk_secret"); process.exit(1)'])).rejects.toMatchObject({ code: "UPDATE_PROCESS_FAILED" });
  expect(redactOutput("https://user:pass@example.com/?token=hidden brk_secret")).toBe("https://[redacted]@example.com/?token=[redacted] [redacted]");
});
