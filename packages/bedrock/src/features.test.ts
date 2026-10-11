import { expect, test } from "bun:test";
import { checkDaemonFeatures, requiredFeatures, daemonFeatures } from "./features";
import { definePebble, socket, service, publicRoute } from "./config";

test("deployment requirements include pebble sockets/services and directory backups", () => {
  const pebble = definePebble({ name: "test", sockets: { "/ws": socket({ message() {} }) }, services: { worker: service({ start() { return 1; } }) }, backup: { directories: ["work"] } });
  expect(requiredFeatures(pebble)).toEqual(["sockets", "services", "directory-backups"]);
  expect(() => checkDaemonFeatures(pebble, {})).toThrow("lacks required features");
  expect(() => checkDaemonFeatures(pebble, { features: ["sockets"] })).toThrow("services");
  expect(() => checkDaemonFeatures(pebble, { features: daemonFeatures })).not.toThrow();
  expect(() => checkDaemonFeatures(definePebble({ name: "plain" }), {})).not.toThrow();
});

test("public routes require daemon support before deploy", () => {
  const pebble = definePebble({ name: "test", routes: { "GET /doc": publicRoute(() => new Response("ok")) } });
  expect(requiredFeatures(pebble)).toEqual(["public-routes"]);
  expect(() => checkDaemonFeatures(pebble, {})).toThrow("public-routes");
  expect(() => checkDaemonFeatures(pebble, { features: daemonFeatures })).not.toThrow();
});
