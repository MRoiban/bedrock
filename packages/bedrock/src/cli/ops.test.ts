import { expect, test } from "bun:test";
import { opsCommand } from "./ops";
import { daemonCommand } from "./daemon";

for (const command of ["login", "logout", "doctor", "service", "tunnel"]) test(`${command} invalid arguments have command-specific hints`, async () => {
  const hint = command === "login" ? "Use bedrock login <domain>, e.g. bedrock login example.com." : expect.stringContaining(`bedrock ${command}`);
  for (const args of [["--unknown"], ["unexpected", "extra"]]) await expect(opsCommand(command, args, false)).rejects.toMatchObject({ code: "INVALID_ARGS", hint });
  if (["login", "service", "tunnel"].includes(command)) await expect(opsCommand(command, [], false)).rejects.toMatchObject({ code: "INVALID_ARGS", hint });
});

for (const command of ["daemon", "deploy", "ls", "logs", "start", "stop", "restart", "rollback", "rm", "token", "whoami", "status"]) test(`${command} invalid arguments have command-specific hints`, async () => {
  await expect(daemonCommand(command, ["--unknown"], false)).rejects.toMatchObject({ code: "INVALID_ARGS", hint: expect.stringContaining(`bedrock ${command}`) });
});
