import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { validateName } from "../config";
import { BedrockError } from "../error";
import { privateFile } from "../private-file";
import { atomicWrite } from "./config";

interface Secret { value: string; updatedAt: number }
type Secrets = Record<string, Secret>;
export function validateSecretName(name: string) {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name) || /^(BEDROCK_|BUN_|NODE_|LD_|DYLD_)/.test(name) || ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "ENV", "BASH_ENV", "IFS", "CDPATH", "SHELLOPTS", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SYSTEMDRIVE"].includes(name))
    throw new BedrockError("INVALID_ARGS", "Invalid or reserved secret name.", "Use uppercase names up to 64 characters; Bedrock and process control environment names are reserved.");
}
export function createSecrets(home: string) {
  const path = (name: string) => { validateName(name); return join(home, "pebbles", name, "secrets.json"); };
  async function read(name: string): Promise<Secrets> {
    const file = Bun.file(path(name));
    if (!await file.exists()) return Object.create(null);
    try {
      await privateFile(path(name));
      const values = await file.json();
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error();
      for (const [key, entry] of Object.entries(values)) {
        validateSecretName(key);
        const secret = entry as Secret;
        if (!secret || typeof secret.value !== "string" || secret.value.includes("\0") || !Number.isSafeInteger(secret.updatedAt)) throw new Error();
      }
      return values;
    } catch { throw new BedrockError("SECRETS_READ_FAILED", "Could not read pebble secrets.", "Check the private secrets.json file permissions and format; restore it from your separate credentials backup."); }
  }
  const metadata = (values: Secrets) => ({ secrets: Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ name, updatedAt: value.updatedAt })) });
  return {
    list: async (name: string) => metadata(await read(name)),
    env: async (name: string) => Object.fromEntries(Object.entries(await read(name)).map(([key, value]) => [key, value.value])),
    async update(name: string, input: unknown) {
      const body = input as { set?: Record<string, string>; unset?: string[]; restart?: boolean };
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["set", "unset", "restart"].includes(key)) ||
          body.restart !== undefined && typeof body.restart !== "boolean" || body.set !== undefined && (!body.set || typeof body.set !== "object" || Array.isArray(body.set)) ||
          body.unset !== undefined && (!Array.isArray(body.unset) || body.unset.some(key => typeof key !== "string")))
        throw new BedrockError("INVALID_ARGS", "Invalid secrets update.", "Send { set?: Record<string,string>, unset?: string[], restart?: boolean }.");
      for (const [key, value] of Object.entries(body.set ?? {})) {
        validateSecretName(key);
        if (typeof value !== "string" || value.includes("\0")) throw new BedrockError("INVALID_ARGS", "Secret values must be strings without NUL bytes.", "Supply a string value for every secret.");
      }
      (body.unset ?? []).forEach(validateSecretName);
      const values = await read(name);
      for (const [key, value] of Object.entries(body.set ?? {})) values[key] = { value, updatedAt: Date.now() };
      for (const key of body.unset ?? []) delete values[key];
      await mkdir(join(home, "pebbles", name), { recursive: true, mode: 0o700 });
      await atomicWrite(path(name), JSON.stringify(values) + "\n");
      return metadata(values);
    },
  };
}
