import { bedrockHome } from "../daemon/config";
import { restartService } from "../service";
import { updateCheckout, type updateRun } from "../self-update";
import { readCredentials } from "./credentials";
import { BedrockError } from "../error";

export async function selfUpdate(options: { checkout?: string; run?: typeof updateRun; restart?: typeof restartService } = {}) {
  return { command: "self-update", ...await updateCheckout(options), ...await (options.restart ?? restartService)({ home: bedrockHome() }) };
}
export async function remoteSelfUpdate(options: { credentials?: typeof readCredentials; fetch?: typeof fetch; sleep?: (ms: number) => Promise<unknown>; now?: () => number; timeout?: number; onUpdate?: (update: { from: string; to: string; updated: boolean }) => void } = {}) {
  const credentials = await (options.credentials ?? readCredentials)();
  if (!credentials) throw new BedrockError("TOKEN_MISSING", "Remote self-update needs a logged-in daemon.", "Run bedrock login <domain> first.");
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const started = now();
  const request = async (path: string, method: string, timeout: number) => {
    const response = await fetcher(new URL(path, credentials.url), { method, headers: { authorization: `Bearer ${credentials.token}` }, redirect: "error", signal: AbortSignal.timeout(timeout) });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new BedrockError(body.error?.code ?? "UPDATE_FAILED", body.error?.message ?? "Remote update failed.", body.error?.hint ?? "Inspect daemon logs.");
    return body.value;
  };
  const before = await request("/api/status", "GET", 3000);
  const update = await request("/api/self-update", "POST", 120000);
  options.onUpdate?.(update);
  const deadline = now() + (options.timeout ?? 120000);
  // The old process keeps its boot-time commit; even an unchanged checkout must restart.
  await (options.sleep ?? Bun.sleep)(2500);
  while (now() < deadline) {
    try {
      const status = await request("/api/status", "GET", Math.max(1, Math.min(3000, deadline - now())));
      if (status.commit === update.to && status.instanceId !== before.instanceId) return { command: "self-update", remote: true, domain: status.domain ?? new URL(credentials.url).hostname.replace(/^bedrock\./, ""), ...update, seconds: Math.round((now() - started) / 1000) };
    } catch { /* A restarting daemon is temporarily unreachable. */ }
    await (options.sleep ?? Bun.sleep)(1000);
  }
  throw new BedrockError("UPDATE_RESTART_TIMEOUT", "The daemon did not report the updated commit within 120 seconds.", "Check the server service and logs; the checkout may already be updated.");
}
