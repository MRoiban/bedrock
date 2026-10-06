import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PebbleConfig } from "../config";
import { definePebble } from "../config";
import { asBedrockError } from "../error";

export async function loadPebble(dir: string): Promise<PebbleConfig> {
  try { return definePebble((await import(pathToFileURL(resolve(dir, "pebble.ts")).href)).default); }
  catch (error) { throw asBedrockError(error, "PEBBLE_LOAD_FAILED", "Ensure pebble.ts default-exports definePebble(...) and its dependencies are installed."); }
}
