import { createInterface } from "node:readline";
import * as C from "./contract.js";
import { provider, startHttpHost, type Environment } from "./host.js";
import { runConsumerChecks } from "./consumer.js";

/**
 * Generated codec entrypoint selected by the observation protocol
 * @param name - Public generated type name
 * @returns Actual generated codec
 */
function selectedCodec(name: string): C.Codec<unknown> {
  const value = (C as unknown as Record<string, unknown>)[name];
  if (typeof value !== "object" || value === null || !("decode" in value) || !("encode" in value))
    throw new Error(`Missing generated codec ${name}`);
  return value as C.Codec<unknown>;
}
/** Adapter environment retained by the hosting process */
const env: Environment = { limits: [], deadlines: [] };
/** Public fixture execution mode */
const mode = process.argv[2] ?? "codec";
if (mode === "self-test") {
  await runConsumerChecks((line) => process.stdout.write(line + "\n"));
} else if (mode === "http-provider") {
  const host = await startHttpHost(env);
  process.stdout.write(JSON.stringify({ port: Number(new URL(host.baseUrl).port) }) + "\n");
  process.once("SIGTERM", () => {
    host.server.closeAllConnections();
    host.server.close();
  });
} else {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const request = JSON.parse(line) as {
      readonly type?: string;
      readonly payload?: string;
      readonly command?: string;
      readonly parametersJson?: string;
      readonly deadlineAt?: number;
    };
    if (mode === "ipc-provider") {
      const result = await provider.handleIpc(request.command!, request.parametersJson!)(
        env,
        new AbortController().signal,
        request.deadlineAt ?? Infinity,
      );
      process.stdout.write(
        JSON.stringify(
          result.isOk()
            ? { response: result.value.value }
            : {
                failure: { kind: "communication", message: "provider rejected inbound message" },
                inbound: result.error,
              },
        ) + "\n",
      );
      continue;
    }
    const codec = selectedCodec(request.type ?? "Envelope");
    const result = codec.decode(request.payload!);
    if (result.isErr()) {
      process.stdout.write(JSON.stringify({ accepted: false, ...result.error }) + "\n");
      continue;
    }
    const encoded = codec.encode(result.value.value);
    if (encoded.isErr()) throw new Error("Accepted generated value failed encoding");
    process.stdout.write(
      JSON.stringify({
        accepted: true,
        encoded: encoded.value,
        diagnostics: result.value.diagnostics,
        violations: [],
      }) + "\n",
    );
  }
}
