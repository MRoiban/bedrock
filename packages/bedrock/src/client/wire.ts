import { BedrockError, asBedrockError } from "../error";

export function remoteError(error: any, status?: number) {
  return new BedrockError(error?.code ?? "REQUEST_FAILED", error?.message ?? "The request failed.", error?.hint ?? "Check the server and retry.", error?.detail, { status, data: error?.data });
}
export const disconnected = () => new BedrockError("CONNECTION_LOST", "The connection closed before the mutation result arrived.", "The client retried 3 times with the same idempotency key. Check the network; a new call uses a new key, so check whether the mutation committed before calling again.");

export function wireArgs(args: unknown) {
  try { return JSON.parse(JSON.stringify(args ?? null)); }
  catch (error) { throw asBedrockError(error, "INVALID_ARGS", "Send JSON-serializable function arguments."); }
}
