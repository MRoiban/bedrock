import type { User } from "../config";
import { BedrockError } from "../error";

// Replace this resolver with signed daemon identity verification in Phase 3.
export function resolveUser(request: Request): User | null {
  if (process.env.BEDROCK_INSECURE_DEV_USER !== "1") return null;
  const header = request.headers.get("x-bedrock-user");
  if (!header) return null;
  try {
    const user: unknown = JSON.parse(header);
    if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string" || !user.id ||
        ("email" in user && typeof user.email !== "string")) throw new Error("Invalid user");
    return user as User;
  } catch {
    throw new BedrockError("INVALID_USER", "Malformed development identity header.", 'Set x-bedrock-user to JSON containing a nonempty string id and optional email.');
  }
}
