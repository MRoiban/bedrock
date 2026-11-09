import { emptyRed, type Red } from "./model";

// Append fields only: persisted positions must survive changes to the public object layout.
const redKeys: (keyof Red)[] = ["starts", "completions", "failures", "client_aborts", "client_errors", "throttled",
  "headers_success", "headers_failure", "lifetime_success", "lifetime_failure", "headers_sum_s", "lifetime_sum_s", "headers_max_s", "lifetime_max_s",
  "handshakes", "inflight", "sockets", "gauge_at", "inflight_ms", "socket_ms", "inflight_peak", "sockets_peak"];
const resourceKeys = ["resident", "swap", "cpu_us", "oom_kills", "source", "interval_ms", "cpu_percent", "covered_ms", "resident_bytes_ms", "swap_bytes_ms", "resident_peak", "swap_peak"];

// Numeric field positions are private to storage; public rows keep the named fields.
export function packRed(value: Red) {
  return JSON.stringify(redKeys.flatMap((key, index) => {
    const field = value[key];
    if (Array.isArray(field)) {
      const buckets = field.flatMap((count, bucket) => count ? [bucket, count] : []);
      return buckets.length ? [index, buckets] : [];
    }
    return field ? [index, field] : [];
  }));
}
export function unpackRed(json: string): Red {
  const fields = JSON.parse(json);
  if (!Array.isArray(fields)) return fields;
  const value = emptyRed();
  for (let i = 0; i < fields.length; i += 2) {
    const key = redKeys[fields[i]]!, field = fields[i + 1];
    if (Array.isArray(field)) for (let j = 0; j < field.length; j += 2) (value[key] as number[])[field[j]] = field[j + 1];
    else (value[key] as number) = field;
  }
  return value;
}
export function packResource(value: object) {
  const fields = resourceKeys.map(key => (value as { [key: string]: unknown })[key] ?? null);
  while (fields.length > 7 && fields.at(-1) === null) fields.pop();
  return JSON.stringify(fields);
}
export function unpackResource(json: string) {
  const fields = JSON.parse(json);
  if (!Array.isArray(fields)) return fields.value;
  return Object.fromEntries(resourceKeys.slice(0, fields.length).map((key, index) => [key, fields[index]]));
}

export function packLog(log: { stream: string; run: string; boot?: string; sequence?: number }) {
  return JSON.stringify([log.stream, log.run, log.boot ?? null, log.sequence ?? null]);
}
export function unpackLog(json: string) {
  const fields = JSON.parse(json);
  return Array.isArray(fields) ? { stream: fields[0], run: fields[1] } : fields;
}
