import { expect, test } from "bun:test";
import { join } from "node:path";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { openDaemonDatabase } from "../src/daemon/db";
import { ErrorStore } from "../src/daemon/errors/store";
import { prepareError } from "../src/daemon/errors/prepare";
import { errorEvent } from "../src/errors/model";
import { tempDirectory } from "./helpers";

test("R3-1 allowed-scoped token cannot read or mutate a private issue through the allowed API path", async () => {
  const temp = tempDirectory();
  await setup(temp.dir, "example.test", "creator@example.test", 0);
  const db = await openDaemonDatabase(temp.dir), store = new ErrorStore(join(temp.dir, "errors.sqlite"));
  let privateId: string, allowedId: string, token: string;
  try {
    for (const name of ["allowed", "private"]) db.save({ name, release: join(temp.dir, "pebbles", name, "releases/r1"), previous_release: null, status: "stopped" });
    token = db.createToken(undefined, { scope: { pebbles: ["allowed"], actions: ["logs", "lifecycle"] } });
    const prepared = (await prepareError(temp.dir, "private", { ...errorEvent(new Error("private-sample"), "server", "route", "r1"), frames: [] }, "server", []))!;
    privateId = store.write("private", prepared)!.issue;
    allowedId = store.write("allowed", { ...prepared, id: crypto.randomUUID() })!.issue;
  } finally { db.close(); store.close(); }
  const daemon = await startDaemon({ home: temp.dir });
  try {
    const api = (suffix: string, method = "GET") => fetch(new URL(`/api/pebbles/allowed/errors/${suffix}`, daemon.server.url), { method, headers: { host: "bedrock.example.test", authorization: `Bearer ${token}` } });
    expect((await api(allowedId)).status).toBe(200);
    for (const [suffix, method] of [[privateId, "GET"], [`${privateId}/resolve`, "POST"], [`${privateId}/ignore`, "POST"], [`${privateId}/merge?confirm=true&target=${allowedId}`, "POST"], [`${allowedId}/merge?confirm=true&target=${privateId}`, "POST"]]) {
      const response = await api(suffix!, method);
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe("NOT_FOUND");
      expect(JSON.stringify(body)).not.toContain("private-sample");
    }
  } finally { await daemon.stop(); temp.cleanup(); }
}, 15000);
