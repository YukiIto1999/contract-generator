import { once } from "node:events";
import type { Check } from "./check.js";
import { runChecks } from "./check.js";
import { openValues } from "./consumer-fixture.js";
import { directChecks } from "./consumer-direct.js";
import { httpChecks, type Fault } from "./consumer-http.js";
import { networkChecks } from "./consumer-network.js";
import { valueChecks } from "./consumer-values.js";
import { startHttpHost, type Environment } from "./host.js";

/**
 * Every named guarantee of the generated consumer, with real socket and process boundaries
 * @param write - Sink of one JSON result line per check
 * @returns Completion after every check reported and the socket host closed
 */
export async function runConsumerChecks(write: (line: string) => void): Promise<void> {
  const values = openValues();
  const env: Environment = { limits: [], deadlines: [] };
  const fault: Fault = { response: undefined };
  const host = await startHttpHost(env, () => fault.response);
  try {
    const checks: readonly Check[] = [
      ...valueChecks(values),
      ...directChecks(values, env),
      ...httpChecks(values, host, env, fault),
      ...networkChecks(values),
    ];
    await runChecks(checks, write);
  } finally {
    host.server.closeAllConnections();
    host.server.close();
    await once(host.server, "close");
  }
}
