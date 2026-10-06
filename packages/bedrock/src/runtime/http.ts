import type { createExecutor } from "./functions";
import { BedrockError, asBedrockError } from "../error";

export function errorResponse(error: unknown) {
  const typed = asBedrockError(error);
  const status = ["FUNCTION_NOT_FOUND", "FILE_NOT_FOUND", "BUCKET_NOT_FOUND", "UPLOAD_NOT_FOUND"].includes(typed.code) ? 404
    : typed.code === "UNAUTHENTICATED" ? 401 : ["FORBIDDEN", "INVALID_IDENTITY"].includes(typed.code) ? 403
    : typed.code === "FILE_TOO_LARGE" ? 413
    : ["INVALID_FILE", "INVALID_CHUNK", "FILE_TYPE_REJECTED", "UPLOAD_CHECKSUM_MISMATCH", "INVALID_ARGS", "INVALID_JSON", "INVALID_USER"].includes(typed.code) ? 400 : 500;
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
