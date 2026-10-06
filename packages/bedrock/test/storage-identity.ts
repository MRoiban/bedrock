import { identityHeaders } from "./helpers";

export function storageIdentity() {
  const previous = process.env.BEDROCK_IDENTITY_SECRET;
  return {
    headers: identityHeaders,
    restore() { if (previous === undefined) delete process.env.BEDROCK_IDENTITY_SECRET; else process.env.BEDROCK_IDENTITY_SECRET = previous; },
  };
}
