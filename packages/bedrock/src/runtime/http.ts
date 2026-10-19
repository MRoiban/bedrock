import type { createExecutor } from "./functions";
import { BedrockError, asBedrockError, errorStatus } from "../error";
import { checkIdempotencyKey } from "./idempotency";

export function errorResponse(error: unknown) {
  const typed = asBedrockError(error);
  return Response.json({ ok: false, error: typed.toJSON() }, { status: errorStatus(typed) });
}

export function functionHandler(execute: ReturnType<typeof createExecutor>, kind: "query" | "mutation") {
  return async (request: Request & { params: { name: string } }) => {
    try {
      let args: unknown;
      try { args = await request.json(); }
      catch { throw new BedrockError("INVALID_JSON", "Request body is not valid JSON.", "Send JSON arguments and Content-Type: application/json; use null for functions without arguments."); }
      const header = kind === "mutation" ? request.headers.get("idempotency-key") : null;
      const options = header === null ? undefined : { idempotencyKey: checkIdempotencyKey(header) };
      const result = await execute(kind, request.params.name, args, request, undefined, undefined, undefined, options);
      return Response.json({ ok: true, value: result.value ?? null });
    } catch (error) { return errorResponse(error); }
  };
}
