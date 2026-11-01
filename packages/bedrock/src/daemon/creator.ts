import type { User } from "../config";
import { BedrockError } from "../error";
import type { DaemonDatabase } from "./db";

export function requireCreator(user: User | null, creators: readonly string[]) {
  if (!user) throw new BedrockError("TOKEN_OWNER_REQUIRED", "This deploy token has no owning creator user.", "On the server, use bedrock pebble-token create <pebble> --name <name> --permissions <grants> --as <existing-creator-email>, or bedrock session create <pebble> --as <existing-creator-email>. For remote login, run bedrock login <domain> on the computer with your browser.");
  if (!creators.some(email => email.toLowerCase() === user.email?.toLowerCase())) throw new BedrockError("FORBIDDEN", "The selected user is not a configured creator.", "Choose an existing user listed in the server's creators configuration.");
  return user;
}

export function tokenCreator(db: DaemonDatabase, token: string, adminToken: string, creators: readonly string[], as: string | null) {
  const owner = db.tokenOwner(token);
  if (as === null) return requireCreator(owner, creators);
  const email = as.trim().toLowerCase();
  if (!email) throw new BedrockError("INVALID_ARGS", "An email is required for --as.", "Pass --as <existing-creator-email>.");
  if (token !== adminToken) {
    if (!owner || owner.email?.toLowerCase() !== email) throw new BedrockError("FORBIDDEN", "Only the local admin token can select another creator.", "Use this token's own identity, or run the command on the server with its local admin token and --as <existing-creator-email>.");
    return requireCreator(owner, creators);
  }
  const user = db.db.query("SELECT id, email, name, COALESCE(avatar_url, '') AS avatarUrl FROM users WHERE email=?").get(email) as User | null;
  if (!user) throw new BedrockError("CREATOR_NOT_FOUND", "No existing user has that email.", "Have that creator sign in to a pebble with Google first, then retry --as with their email. This command never creates users or creators.");
  return requireCreator(user, creators);
}
