import { startPebble } from "./index";
import { asBedrockError } from "../error";

try {
  const running = await startPebble({ dir: process.env.BEDROCK_RELEASE!, dataDir: process.env.BEDROCK_DATA!, port: 0 });
  process.send?.({ name: running.pebble.name, port: running.server.port });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await running.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("message", message => { if ((message as { op?: string })?.op === "stop") void stop(); });
  process.on("disconnect", stop);
} catch (error) {
  const typed = asBedrockError(error).toJSON();
  console.error(JSON.stringify(typed));
  process.send?.({ error: typed });
  process.exitCode = 1;
}
