import { BedrockError, asBedrockError } from "../error";
import type { startPebble } from "./index";
import { handleServiceToken } from "./service-tokens";

export async function handleControl(running: Pick<Awaited<ReturnType<typeof startPebble>>, "jobs" | "execute">, message: unknown) {
  const { op, requestId, name } = message as { op: string; requestId: string; name: string };
  try {
    if (op === "service-token") return await handleServiceToken(running.execute, message);
    let value: unknown;
    if (op === "jobs.list") value = running.jobs.list();
    else if (op === "jobs.run") value = await running.jobs.run(name);
    else throw new BedrockError("UNKNOWN_OPERATION", `Unknown child operation: ${op}`, "Use jobs.list, jobs.run, or service-token through the daemon.");
    return { op: "reply", requestId, value };
  } catch (error) { return { op: "reply", requestId, error: asBedrockError(error).toJSON() }; }
}
