import type { BunPlugin } from "bun";
import { join } from "node:path";

// server/static entries pick files by runtime condition, which Bun.resolveSync would get wrong for the browser.
const singletons = /^react(-dom)?(\/(?!server|static).*)?$/;

// Linked Bedrock packages resolve React from their real path, so without this the browser
// would load the pebble's React and Bedrock's React side by side and hooks would break.
const plugin: BunPlugin = {
  name: "bedrock-single-react",
  setup(build) {
    build.onResolve({ filter: singletons }, args => {
      try { return { path: Bun.resolveSync(args.path, process.cwd()) }; } catch { return undefined; }
    });
  },
};
export default plugin;

export const bundlerPlugin = "bedrock/bundler";

// Bun reads serve.static plugins only from bunfig; a pebble's own bunfig.toml replaces ours and must list the plugin itself.
export async function bunConfigArgs(dir: string) {
  return await Bun.file(join(dir, "bunfig.toml")).exists() ? [] : [`--config=${join(import.meta.dir, "bunfig.toml")}`];
}
