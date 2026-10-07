import type { Client, Connection } from "../client";

export function watchConnection(client: Pick<Client, "connection" | "onConnection">, changed: (connection: Connection) => void) {
  const unsubscribe = client.onConnection(changed);
  changed(client.connection());
  return unsubscribe;
}
