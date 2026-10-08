import { expect, test } from "bun:test";
import { checkDaemonFeatures, requiredFeatures, daemonFeatures } from "./features";
import { definePebble, socket, service } from "./config";

test("deployment requirements include plugin sockets/services and directory backups", () => {
  const pebble = definePebble({ name: "test", plugins: [{ name: "plugin", sockets: { "/ws": socket({ message() {} }) }, services: { worker: service({ start() { return 1; } }) } }], backup: { directories: ["work"] } });
  expect(requiredFeatures(pebble)).toEqual(["sockets", "services", "directory-backups"]);
  expect(() => checkDaemonFeatures(pebble, {})).toThrow("lacks required features");
  expect(() => checkDaemonFeatures(pebble, { features: ["sockets"] })).toThrow("services");
  expect(() => checkDaemonFeatures(pebble, { features: daemonFeatures })).not.toThrow();
  expect(() => checkDaemonFeatures(definePebble({ name: "plain" }), {})).not.toThrow();
});
