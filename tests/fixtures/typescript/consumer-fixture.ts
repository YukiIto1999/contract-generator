import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { AsyncResult, Err, Ok, type Result } from "ts-results-es";
import * as C from "./contract.js";
import type { IpcTransport } from "./client.js";

/** Independently authored common fixture rather than generator-derived expectations */
export const envelopeJson =
  '{"requestId":"00000000-0000-0000-0000-000000000001","recordId":"00000000-0000-0000-0000-000000000002","correlationId":"00000000-0000-0000-0000-000000000003","label":"😀😀😀","count":3,"amount":"9007199254740993123456789.123456789012345678900","occurredAt":"0000-02-29T12:34:56.1234567890123456789+05:45","nullableText":null,"items":[{"kind":"text","text":"😀"}]}';

/**
 * Accepted value extraction restricted to fixture assertions
 * @typeParam T - Public generated type
 * @param result - Generated public acceptance
 * @returns Accepted value
 */
export function accepted<T>(result: Result<C.Accepted<T>, readonly C.Violation[]>): T {
  assert.equal(result.isOk(), true, result.isErr() ? JSON.stringify(result.error) : "");
  if (result.isErr()) throw new Error("Expected accepted fixture");
  return result.value.value;
}

/** Shared accepted values and their wire form */
export interface Values {
  readonly value: C.Envelope;
  readonly wire: Record<string, unknown>;
  readonly input: C.SubmitInput;
  readonly explicitInput: C.SubmitInput;
}

/**
 * Accepted fixture values built through the public codecs
 * @returns Envelope, wire object and operation inputs
 */
export function openValues(): Values {
  const value = accepted(C.Envelope.decode(envelopeJson));
  const encoded = C.Envelope.encode(value);
  assert.equal(encoded.isOk(), true);
  if (encoded.isErr()) throw new Error("Expected encoding");
  return {
    value,
    wire: JSON.parse(encoded.value) as Record<string, unknown>,
    input: accepted(C.SubmitInput.create({ input: value })),
    explicitInput: accepted(C.SubmitInput.create({ input: value, limit: 2 })),
  };
}

/** Separate-process IPC peer */
export interface ProcessPeer {
  readonly transport: IpcTransport;
  close(): Promise<void>;
}

/**
 * Real process IPC adapter without a reimplementation of the contract
 * @returns Process transport and deterministic shutdown
 */
export function processTransport(): ProcessPeer {
  const child = spawn(
    process.execPath,
    [new URL("./driver.js", import.meta.url).pathname, "ipc-provider"],
    {
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const lines = createInterface({ input: child.stdout });
  const transport: IpcTransport = {
    request: (command, parametersJson, context) =>
      new AsyncResult(
        (async (): Promise<Result<string, C.CommunicationFailure>> => {
          context.signal.throwIfAborted();
          const received = once(lines, "line", { signal: context.signal });
          child.stdin.write(
            JSON.stringify({ command, parametersJson, deadlineAt: context.deadlineAt }) + "\n",
          );
          const [line] = await received;
          const message = JSON.parse(String(line)) as {
            readonly response?: string;
            readonly failure?: C.CommunicationFailure;
          };
          return message.failure ? Err(message.failure) : Ok(message.response!);
        })(),
      ),
  };
  return {
    transport,
    async close() {
      lines.close();
      child.stdin.end();
      await once(child, "exit");
    },
  };
}
