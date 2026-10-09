import { handleControl } from "./control";
import { loadPebble } from "./load";
import { serviceStopTimeout } from "../config/hosting";
import { startPebble } from "./index";
import { asBedrockError } from "../error";

try {
  const pebble = await loadPebble(process.env.BEDROCK_RELEASE!);
  // Startup failures may unwind services before readiness; publish the budget first.
  process.send?.({ op: "stop-budget", stopTimeout: serviceStopTimeout(pebble.services ?? {}) });
  const running = await startPebble({ pebble, dir: process.env.BEDROCK_RELEASE!, dataDir: process.env.BEDROCK_DATA!, port: 0, dev: process.env.BEDROCK_DEV === "1" });
  process.send?.({ name: running.pebble.name, port: running.server.port, stopTimeout: running.stopTimeout });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await running.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("message", message => {
    if ((message as { op?: string })?.op === "stop") void stop();
    else void handleControl(running, message).then(value => process.send?.(value));
  });
  process.on("disconnect", stop);
} catch (error) {
  const typed = asBedrockError(error).toJSON();
  console.error(JSON.stringify(typed));
  process.send?.({ error: typed });
  process.exitCode = 1;
}
