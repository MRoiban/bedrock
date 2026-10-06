import type { createExecutor } from "./functions";
import { BedrockError, asBedrockError } from "../error";

export function errorResponse(error: unknown) {
  const typed = asBedrockError(error);
  const status = typed.code === "FUNCTION_NOT_FOUND" ? 404
    : typed.code === "UNAUTHENTICATED" ? 401 : typed.code === "FORBIDDEN" ? 403
    : ["INVALID_ARGS", "INVALID_JSON", "INVALID_USER"].includes(typed.code) ? 400 : 500;
  return Response.json({ ok: false, error: typed.toJSON() }, { status });
}

export function functionHandler(execute: ReturnType<typeof createExecutor>, kind: "query" | "mutation") {
  return async (request: Request & { params: { name: string } }) => {
    try {
      let args: unknown;
      try { args = await request.json(); }
      catch { throw new BedrockError("INVALID_JSON", "Request body is not valid JSON.", "Send JSON arguments and Content-Type: application/json; use null for functions without arguments."); }
      const result = await execute(kind, request.params.name, args, request);
      return Response.json({ ok: true, value: result.value ?? null });
    } catch (error) { return errorResponse(error); }
  };
}
