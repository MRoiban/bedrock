import { resolve } from "node:path";
import { bedrockHome } from "../daemon/config";
import { restartService } from "../service";
import { run } from "./terminal";
import { BedrockError } from "../error";

export async function selfUpdate(options: { checkout?: string; run?: typeof run; restart?: typeof restartService } = {}) {
  const checkout = options.checkout ?? resolve(import.meta.dir, "../../../..");
  const execute = options.run ?? run;
  if (!await Bun.file(resolve(checkout, "install.sh")).exists()) throw new BedrockError("CHECKOUT_REQUIRED", "Self-update needs a source checkout.", "Install bedrock from a stable git checkout with install.ps1 on Windows or install.sh on macOS/Linux.");
  await execute(["git", "pull", "--ff-only"], { cwd: checkout });
  await execute([process.execPath, "install"], { cwd: checkout });
  return { command: "self-update", updated: true, ...await (options.restart ?? restartService)({ home: bedrockHome() }) };
}
