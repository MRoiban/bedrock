import { expect, test } from "bun:test";
import { BedrockError } from "../error";
import { definePebble, detached, publicRoute, query, socket, bucket, job } from "./index";
import { isPublicRoute, publicRouteKeys } from "./public-route";

test("publicRoute composes with detached and is restricted to HTTP routes", () => {
  const handler = () => new Response("ok");
  for (const route of [publicRoute(handler), publicRoute(detached(handler)), detached(publicRoute(handler))]) {
    expect(isPublicRoute(route)).toBe(true);
    expect(publicRouteKeys(definePebble({ name: "sample", routes: { "GET /doc": route } }).routes)).toEqual(["GET /doc"]);
  }
  for (const value of [socket({ message() {} }), query(() => null), job("0 * * * *", () => {}, { transaction: false }), bucket("files", { access: "public", maxSize: 10 })])
    expect(() => publicRoute(value as any)).toThrow(BedrockError);
  for (const config of [
    { sockets: { "/socket": publicRoute(handler) } },
    { queries: { doc: query(publicRoute(handler) as any) } },
    { storage: [publicRoute(handler)] },
    ...["GET /*", "GET //:id", "GET /x/../:id", "GET /x/%2e%2e/:id"].map(key => ({ routes: { [key]: publicRoute(handler) } })),
    { routes: { "GET /_bedrock/health": publicRoute(handler) } },
  ]) expect(() => definePebble({ name: "sample", ...config } as any)).toThrow(BedrockError);
});
