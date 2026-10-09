import { BedrockError, asBedrockError } from "../error";

export function remoteError(error: any) {
  return new BedrockError(error?.code ?? "REQUEST_FAILED", error?.message ?? "The request failed.", error?.hint ?? "Check the server and retry.");
}
export const disconnected = () => new BedrockError("CONNECTION_LOST", "The connection closed before the mutation result arrived.", "Check whether the mutation committed before retrying; mutations are never replayed automatically.");

export function wireArgs(args: unknown) {
  try { return JSON.parse(JSON.stringify(args ?? null)); }
  catch (error) { throw asBedrockError(error, "INVALID_ARGS", "Send JSON-serializable function arguments."); }
}
