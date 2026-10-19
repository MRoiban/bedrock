export class BedrockError extends Error {
  readonly name = "BedrockError";
  // Declared, not initialized, so errors without them keep their old own-property shape.
  declare readonly status?: number;
  declare readonly data?: unknown;

  constructor(
    readonly code: string,
    message: string,
    readonly hint: string,
    readonly detail?: string,
    options: { status?: number | undefined; data?: unknown } = {},
  ) {
    super(message);
    if (options.status !== undefined) this.status = options.status;
    if (options.data !== undefined) this.data = options.data;
  }

  toJSON() {
    const data = serializableData(this);
    return {
      code: this.code, message: this.message, hint: this.hint,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
      ...(data === undefined ? {} : { data }),
    };
  }
}

// A broken data payload must not turn an intended client error into a 500.
function serializableData(error: BedrockError) {
  if (error.data === undefined) return undefined;
  try {
    const json = JSON.stringify(error.data);
    return json === undefined ? undefined : JSON.parse(json) as unknown;
  } catch {
    console.warn(`BedrockError ${error.code} data is not JSON-serializable; omitting it.`);
    return undefined;
  }
}

// Only Bedrock knows which errors were unexpected throws; pebbles cannot claim it.
const wrapped = new WeakSet<BedrockError>();

export function asBedrockError(error: unknown, code = "INTERNAL_ERROR", hint = "Check the pebble's code and server logs.") {
  if (error instanceof BedrockError) return error;
  const typed = new BedrockError(code, error instanceof Error ? error.message : String(error), hint);
  wrapped.add(typed);
  return typed;
}

const STATUS: Record<string, number> = {
  FUNCTION_NOT_FOUND: 404, FILE_NOT_FOUND: 404, BUCKET_NOT_FOUND: 404, UPLOAD_NOT_FOUND: 404,
  UNAUTHENTICATED: 401, FORBIDDEN: 403, INVALID_IDENTITY: 403, FILE_TOO_LARGE: 413,
  QUOTA_EXCEEDED: 400, INVALID_FILE: 400, INVALID_CHUNK: 400, FILE_TYPE_REJECTED: 400, UPLOAD_CHECKSUM_MISMATCH: 400,
  INVALID_ARGS: 400, INVALID_TOKEN_PERMISSION: 400, INVALID_JSON: 400, INVALID_USER: 400,
  LOGIN_LIMIT: 429, PEBBLE_STOPPED: 503,
  // Programming or server faults that callers cannot fix by changing the request.
  READ_ONLY: 500, UNKNOWN_TABLE: 500, DETACHED_CONTEXT: 500, OAUTH_NOT_CONFIGURED: 500,
  UNKNOWN_BUCKET: 500, TOKENS_DISABLED: 500,
};

export function errorStatus(error: BedrockError) {
  const { status, code } = error;
  if (Number.isInteger(status) && status! >= 400 && status! <= 599) return status!;
  if (Object.hasOwn(STATUS, code)) return STATUS[code]!;
  if (code === "NOT_FOUND" || code.endsWith("_NOT_FOUND")) return 404;
  if (code === "CONFLICT" || code.endsWith("_CONFLICT")) return 409;
  if (code === "RATE_LIMITED") return 429;
  if (code.startsWith("INVALID_")) return 400;
  return wrapped.has(error) ? 500 : 400;
}
