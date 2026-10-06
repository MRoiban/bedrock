import { verifyIdentity } from "../auth/identity";

export function resolveUser(request: Request) {
  return verifyIdentity(request, process.env.BEDROCK_IDENTITY_SECRET);
}
