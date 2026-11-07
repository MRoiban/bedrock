import { expect, test } from "bun:test";
import { join, basename } from "node:path";
import { installRelease } from "../src/daemon/archive";
import { buildReleaseWeb } from "../src/daemon/web-build";
import { startPebble } from "../src/runtime";
import { symbolicate } from "../src/daemon/source-maps";
import { tempDirectory } from "./helpers";

test("static releases privatize existing maps and remove JS/CSS map references", async () => {
  const temp = tempDirectory(), release = join(temp.dir, "release");
  await Bun.write(join(release, "pebble.ts"), `import {definePebble} from 'bedrock';export default definePebble({name:'static',web:'public'});`);
  await Bun.write(join(release, "public/index.html"), '<script src="/app-abcdef12.js"></script>');
  await Bun.write(join(release, "public/app-abcdef12.js"), 'console.log("static");\n//# sourceMappingURL=private-map.map');
  await Bun.write(join(release, "public/app.css"), 'body{color:red}/*# sourceMappingURL=app.css.map */');
  const map = JSON.stringify({ version: 3, sources: ["original.ts"], names: ["start"], mappings: "AAAAA" });
  for (const file of ["private-map.map", "app.css.map"]) await Bun.write(join(release, "public", file), map);
  await Bun.write(join(release, "public/inline.js"), 'console.log("inline");\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(map).toString("base64"));
  await installRelease(release);
  await buildReleaseWeb(release, { BEDROCK_HOME: join(temp.dir, "home") }, value => value);
  const running = await startPebble({ dir: release, dataDir: join(temp.dir, "data"), port: 0 });
  const request = (path: string) => fetch(new URL(path, running.server.url));
  try {
    for (const path of ["/app-abcdef12.js.map", "/private-map.map", "/app.css.map", "/.bedrock-web/", "/.bedrock-web/maps", "/.bedrock-web/maps/app-abcdef12.js.map"]) expect((await request(path)).status).toBe(404);
    for (const path of ["/app-abcdef12.js", "/app.css", "/inline.js"]) expect(await (await request(path)).text()).not.toContain("sourceMappingURL");
    expect(await symbolicate(temp.dir, basename(release), "/inline.js", 1, 1)).toEqual({ source: "original.ts", line: 1, column: 1, function: "start" });
    expect(await symbolicate(temp.dir, basename(release), "/app-abcdef12.js", 1, 1)).toEqual({ source: "original.ts", line: 1, column: 1, function: "start" });
  } finally { await running.stop(); temp.cleanup(); }
}, 10000);
