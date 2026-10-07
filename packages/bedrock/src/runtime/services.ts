import type { ServiceContext, ServiceDefinition } from "../config";
import { BedrockError, asBedrockError } from "../error";

export const SERVICE_STOP_TIMEOUT = 2000;
export function createServices(definitions: Record<string, ServiceDefinition>) {
  const values: Record<string, any> = Object.create(null);
  const started: string[] = [];
  const controller = new AbortController();
  let stopWork: Promise<void> | undefined;
  async function stop() {
    if (stopWork) return stopWork;
    controller.abort();
    stopWork = (async () => {
      // A shared deadline keeps N stuck services from extending the drain window N times.
      const deadline = Date.now() + SERVICE_STOP_TIMEOUT;
      for (const name of [...started].reverse()) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const finished = await Promise.race([
            Promise.resolve().then(() => definitions[name]!.stop?.(values[name])).then(() => true),
            new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now())); }),
          ]);
          if (!finished) console.error(new BedrockError("SERVICE_STOP_TIMEOUT", `Service ${name} exceeded the shutdown deadline.`, "Observe ctx.signal and finish cleanup within two seconds; the supervisor may force-kill a stuck child.").toJSON());
        } catch (error) { console.error(`Service ${name} stop failed`, asBedrockError(error, "SERVICE_STOP_FAILED", "Check the service stop handler; shutdown continues with the remaining services.").toJSON()); }
        finally { clearTimeout(timer); }
      }
    })();
    return stopWork;
  }
  return {
    values, stop,
    async start(ctx: Omit<ServiceContext, "signal">) {
      for (const [name, definition] of Object.entries(definitions)) {
        try { values[name] = await definition.start({ ...ctx, signal: controller.signal }); started.push(name); }
        catch (error) {
          await stop();
          throw new BedrockError("SERVICE_START_FAILED", `Service ${name} failed to start: ${error instanceof Error ? error.message : String(error)}`, "Check the service start handler and resources; readiness waits for all services.");
        }
      }
    },
  };
}
