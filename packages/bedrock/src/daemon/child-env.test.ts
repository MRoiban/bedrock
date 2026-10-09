import { expect, test } from "bun:test";
import { childEnvironment } from "./child-env";

test("child environment excludes daemon credentials and reserves Bedrock values", () => {
  expect(childEnvironment({ CLOUDFLARE_API_TOKEN: "cloud", MANAGER_BEDROCK_TOKEN: "admin", PATH: "/bin" },
    { APP_SECRET: "secret", BEDROCK_HOME: "spoof" }, false, { BEDROCK_HOME: "/private/home" })).toEqual({
    PATH: "/bin", APP_SECRET: "secret", BEDROCK_HOME: "/private/home",
  });
});

test("child environment matches host keys case-insensitively and preserves their casing", () => {
  expect(childEnvironment({ Path: "C:\\bin", SystemRoot: "C:\\Windows", https_proxy: "proxy", Lc_Messages: "fr", LANG: undefined, NODE_OPTIONS: "unsafe" }, {}, false, {}))
    .toEqual({ Path: "C:\\bin", SystemRoot: "C:\\Windows", https_proxy: "proxy", Lc_Messages: "fr" });
});

test("attached dev sources inherit the developer's shell environment", () => {
  expect(childEnvironment({ OPENAI_API_KEY: "dev", PATH: "/bin" }, { APP_SECRET: "secret" }, true, { BEDROCK_DEV: "1" }))
    .toEqual({ OPENAI_API_KEY: "dev", PATH: "/bin", APP_SECRET: "secret", BEDROCK_DEV: "1" });
});
