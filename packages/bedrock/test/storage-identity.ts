export function storageIdentity() {
  const previous = process.env.BEDROCK_INSECURE_DEV_USER;
  process.env.BEDROCK_INSECURE_DEV_USER = '1';
  return {
    headers(id = 'alice') { return { 'x-bedrock-user': JSON.stringify({ id }) }; },
    restore() { if (previous === undefined) delete process.env.BEDROCK_INSECURE_DEV_USER; else process.env.BEDROCK_INSECURE_DEV_USER = previous; },
  };
}
