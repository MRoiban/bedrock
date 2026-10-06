export class BedrockError extends Error {
  readonly name = "BedrockError";

  constructor(
    readonly code: string,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint };
  }
}

export function asBedrockError(error: unknown, code = "INTERNAL_ERROR", hint = "Check the pebble's code and server logs.") {
  return error instanceof BedrockError
    ? error
    : new BedrockError(code, error instanceof Error ? error.message : String(error), hint);
}
