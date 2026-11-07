import { serviceStopTimeout, DEFAULT_SERVICE_STOP_TIMEOUT, type ServiceContext, type ServiceDefinition } from "../config";
import { BedrockError, asBedrockError } from "../error";

export const SERVICE_STOP_TIMEOUT = DEFAULT_SERVICE_STOP_TIMEOUT;
export function createServices(definitions: Record<string, ServiceDefinition>) {
  const stopTimeout = serviceStopTimeout(definitions);
  const values: Record<string, any> = Object.create(null);
  const started: string[] = [];
  const exclusiveNames = Object.keys(definitions).filter(name => definitions[name]!.exclusive);
  const controller = new AbortController();
  let stopWork: Promise<void> | undefined;
  let exclusiveWork: Promise<{ started: string[] }> | undefined;
  function unavailable(name: string) {
    Object.defineProperty(values, name, { configurable: true, enumerable: true, get() {
      throw new BedrockError("SERVICE_NOT_STARTED", `Service ${name} is not running yet.`, "Exclusive services start after the previous release stops. Retry shortly, or check the pebble logs if this persists.");
    } });
  }
  exclusiveNames.forEach(unavailable);
  async function unwind(names: string[]) {
    // A shared deadline keeps N stuck services from extending the drain window N times.
    const deadline = Date.now() + stopTimeout;
    for (const name of names.reverse()) {
      started.splice(started.indexOf(name), 1);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const finished = await Promise.race([
          Promise.resolve().then(() => definitions[name]!.stop?.(values[name])).then(() => true),
          new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now())); }),
        ]);
        if (!finished) console.error(new BedrockError("SERVICE_STOP_TIMEOUT", `Service ${name} exceeded the shutdown deadline.`, "Observe ctx.signal and finish cleanup within the declared stopTimeout; the supervisor may force-kill a stuck child.").toJSON());
      } catch (error) { console.error(`Service ${name} stop failed`, asBedrockError(error, "SERVICE_STOP_FAILED", "Check the service stop handler; shutdown continues with the remaining services.").toJSON()); }
      finally { clearTimeout(timer); if (definitions[name]!.exclusive) unavailable(name); }
    }
  }
  async function stop() {
    if (stopWork) return stopWork;
    controller.abort();
    stopWork = (async () => {
      // A start already in progress may still acquire a resource after cancellation.
      await exclusiveWork?.catch(() => {});
      await unwind([...started]);
    })();
    return stopWork;
  }
  async function startNames(names: string[], ctx: Omit<ServiceContext, "signal">) {
    for (const name of names) {
      if (controller.signal.aborted) throw new BedrockError("SERVICE_NOT_STARTED", `Service ${name} cannot start during shutdown.`, "Restart the pebble before starting services.");
      try {
        const value = await definitions[name]!.start({ ...ctx, signal: controller.signal });
        Object.defineProperty(values, name, { configurable: true, enumerable: true, writable: true, value });
        started.push(name);
      } catch (error) {
        throw new BedrockError("SERVICE_START_FAILED", `Service ${name} failed to start: ${error instanceof Error ? error.message : String(error)}`, "Check the service start handler and resources; inspect the pebble logs and restart or redeploy.");
      }
    }
  }
  return {
    values, stop, stopTimeout, exclusiveNames,
    ready: () => !controller.signal.aborted && started.length === Object.keys(definitions).length,
    async start(ctx: Omit<ServiceContext, "signal">) {
      try { await startNames(Object.keys(definitions).filter(name => !definitions[name]!.exclusive), ctx); }
      catch (error) { await stop(); throw error; }
    },
    startExclusive(ctx: Omit<ServiceContext, "signal">) {
      return exclusiveWork ??= startNames(exclusiveNames, ctx).then(() => ({ started: exclusiveNames })).catch(async error => {
        await unwind(started.filter(name => definitions[name]!.exclusive));
        throw error;
      });
    },
  };
}
