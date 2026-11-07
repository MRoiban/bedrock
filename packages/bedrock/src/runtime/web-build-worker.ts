import { asBedrockError } from "../error";
import { buildWeb } from "./web-build";

try {
  await buildWeb(process.cwd());
  // Configuration imports may leave timers alive; they do not belong to the build.
  process.exit(0);
}
catch (error) {
  console.error(JSON.stringify(asBedrockError(error, "WEB_BUILD_FAILED", "Fix the browser entry, bunfig plugins or production dependencies, then redeploy. The previous release is still selected.").toJSON()));
  process.exit(1);
}
