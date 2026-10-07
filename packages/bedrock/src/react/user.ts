import type { User } from "../config/types";
import { asBedrockError, type BedrockError } from "../error";
import type { Browser } from "../client/browser";

export interface UserState { user: User | null; isLoading: boolean; error: BedrockError | undefined }
export const initialUser: UserState = { user: null, isLoading: true, error: undefined };

export function watchUser(load: () => Promise<User | null>, changed: (state: UserState) => void, browser?: Browser) {
  let state = initialUser;
  let active = true, running = false, again = false, attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule: Browser["setTimeout"] = browser?.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const cancel: Browser["clearTimeout"] = browser?.clearTimeout ?? (id => globalThis.clearTimeout(id));
  async function run() {
    cancel(timer!); timer = undefined;
    if (!active) return;
    if (running) { again = true; return; }
    running = true;
    try {
      const user = await load();
      if (!active) return;
      attempt = 0;
      state = { user, isLoading: false, error: undefined };
      changed(state);
    } catch (cause) {
      if (!active) return;
      state = { ...state, isLoading: false, error: asBedrockError(cause) };
      changed(state);
      timer = schedule(() => { void run(); }, Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)));
    } finally {
      running = false;
      if (active && again) { again = false; void run(); }
    }
  }
  const retry = () => { void run(); };
  const visible = () => { if (!browser?.document.hidden) retry(); };
  browser?.window.addEventListener("online", retry);
  browser?.document.addEventListener("visibilitychange", visible);
  retry();
  return {
    retry,
    close() {
      active = false; cancel(timer!);
      browser?.window.removeEventListener("online", retry);
      browser?.document.removeEventListener("visibilitychange", visible);
    },
  };
}
