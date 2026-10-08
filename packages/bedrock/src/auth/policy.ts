import type { Access, User } from "../config";
import { BedrockError } from "../error";

export function enforceAccess(access: Access = "public", user: User | null, creators: readonly string[] = []) {
  if (access === "public") return;
  if (!user) throw new BedrockError("UNAUTHENTICATED", "Sign-in is required.", "Open the pebble in your browser and sign in.");
  const email = user.email?.toLowerCase() ?? "";
  const allowed = access === "users" || (access === "creators"
    ? creators.some(entry => entry.toLowerCase() === email)
    // "creators" in an allow-list admits the server's configured creators alongside listed emails/domains.
    : access.allow.some(entry => entry === "creators" ? creators.some(creator => creator.toLowerCase() === email) : entry.startsWith("@") ? email.endsWith(entry.toLowerCase()) : email === entry.toLowerCase()));
  if (!allowed) throw new BedrockError("FORBIDDEN", "This account cannot access the pebble.", "Sign in with an email permitted by the pebble's access policy.");
}
