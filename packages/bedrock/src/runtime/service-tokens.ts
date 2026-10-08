import type { User } from "../config";
import type { createExecutor } from "./functions";
import { asBedrockError } from "../error";

// Only the supervising parent can reach this IPC operation; it is not an HTTP route.
export async function handleServiceToken(execute: ReturnType<typeof createExecutor>, message: unknown) {
  const { requestId, user, input, id } = message as { requestId: string; user: User; input?: { name: string; permissions: string[] }; id?: string };
  try {
    const result = await execute("mutation", "service-token", null, new Request("http://localhost"), { user }, ctx => {
      if (id !== undefined) { ctx.tokens.revoke(id); return { revoked: true }; }
      const created = ctx.tokens.create({ name: input?.name!, permissions: input?.permissions! });
      return { id: created.id, token: created.token };
    });
    return { op: "service-token-result", requestId, value: result.value };
  } catch (error) { return { op: "service-token-result", requestId, error: asBedrockError(error).toJSON() }; }
}
