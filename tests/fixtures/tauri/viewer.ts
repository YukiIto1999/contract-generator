import { AsyncResult, Err, Ok, type Result } from "ts-results-es";
import { createIpcClient, type IpcTransport } from "../generated/typescript/client.js";
import * as C from "../generated/typescript/contract.js";

/** Tauri global supplied only by the actual native webview */
declare global {
  interface Window {
    /** Real host invocation injected by Tauri */
    __TAURI__: {
      core: { invoke<T>(command: string, arguments_?: Record<string, unknown>): Promise<T> };
    };
  }
}

/** Real Tauri command exchange */
const invoke = window.__TAURI__.core.invoke;
/** Visible scenario evidence in observation order */
const checks: string[] = [];
/** Exact client parameters captured before native IPC */
const sent: string[] = [];
/** The caller-owned cancellation signal forwarded by the generated consumer */
const signal = new AbortController().signal;

/** Assertion of an independently specified contract observation
 * @param condition - Public result or state comparison
 * @param message - Failed observation description
 * @throws {@link Error} An unexpected public result
 */
function requireObservation(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Named scenario evidence appended to the actual webview
 * @param name - Stable check identity
 * @param detail - User-visible observed result
 */
function observed(name: string, detail: string): void {
  checks.push(name);
  const item = document.createElement("li");
  item.textContent = detail;
  document.querySelector("#checks")?.append(item);
}

/** Native transport with separate communication and cancellation classifications */
const transport: IpcTransport = {
  request(command, parametersJson, context) {
    context.signal.throwIfAborted();
    sent.push(parametersJson);
    return new AsyncResult<string, C.CommunicationFailure>(
      invoke<string>("contract_request", { command, parametersJson }).then(
        (value): Result<string, C.CommunicationFailure> => Ok(value),
        (failure: unknown) => {
          if (typeof failure !== "object" || failure === null || !("kind" in failure))
            throw failure;
          if (failure.kind === "cancelled")
            throw new DOMException("Host stopped the request", "AbortError");
          if (failure.kind === "unavailable" || failure.kind === "communication")
            return Err<C.CommunicationFailure>({
              kind: "communication",
              message: "Host is unavailable",
            });
          throw failure;
        },
      ),
    );
  },
};
/** Generated consumer bound to the actual native transport */
const client = createIpcClient({ transport });

/** Generated public construction of an operation input before the client call
 * @param label - Contract label candidate
 * @param amount - Explicit amount, omitted to leave the provider default in force
 * @returns Accepted generated input
 * @throws {@link Error} A fixture candidate that the generated constructor rejects
 */
function recordInput(label: string, amount?: number): C.RecordInput {
  const created = C.RecordInput.create(amount === undefined ? { label } : { label, amount });
  requireObservation(created.isOk(), `generated construction rejected ${label}`);
  return created.value.value;
}

/** Generated public construction of the empty inspection input
 * @returns Accepted generated input
 * @throws {@link Error} A generated constructor that rejects the empty input
 */
function inspectInput(): C.InspectInput {
  const created = C.InspectInput.create({});
  requireObservation(created.isOk(), "generated construction rejected the empty inspection input");
  return created.value.value;
}

/** Host rejection observed at the raw untrusted command boundary
 * @param command - Published or deliberately unknown command
 * @param parametersJson - Deliberately untrusted wire input
 * @returns Typed host failure rather than a successful response
 * @throws {@link Error} A boundary violation accepted as success
 */
async function rejectedBoundary(
  command: string,
  parametersJson: string,
): Promise<Record<string, unknown>> {
  try {
    await invoke("contract_request", { command, parametersJson });
  } catch (failure) {
    requireObservation(
      typeof failure === "object" && failure !== null && "kind" in failure,
      "untyped host rejection",
    );
    return failure as Record<string, unknown>;
  }
  throw new Error("invalid boundary input reached a successful response");
}

/** Deterministic generated-consumer scenario across the actual Wry IPC boundary
 * @returns Completion after every result and lifecycle observation
 * @throws {@link Error} A contract observation mismatch
 */
async function scenario(): Promise<void> {
  const early = await client.record(recordInput("早期"))({}, signal, Infinity);
  requireObservation(
    early.isErr() && "kind" in early.error && early.error.kind === "communication",
    "request admitted before host readiness",
  );
  observed("not-ready", "Before readiness: request refused without a write");
  await invoke("lifecycle", { action: "start" });

  const first = await client.record(recordInput("😀😀😀😀"))({}, signal, Infinity);
  requireObservation(
    first.isOk() && first.value.case === "Recorded",
    "generated success case was not reconstructed",
  );
  requireObservation(
    first.value.value.total === 2 &&
      first.value.value.writes === 1 &&
      first.value.value.label === "😀😀😀😀",
    "provider default or Unicode payload was changed",
  );
  requireObservation(
    JSON.stringify(JSON.parse(sent[1] ?? "null")) === JSON.stringify({ label: "😀😀😀😀" }),
    "client filled the provider-owned default",
  );
  observed(
    "provider-default",
    "Recorded four Unicode code points: default amount 2; total 2; writes 1",
  );

  const second = await client.record(recordInput("明示", 3))({}, signal, Infinity);
  requireObservation(
    second.isOk() && second.value.value.total === 5 && second.value.value.writes === 2,
    "explicit amount or second state transition was lost",
  );
  observed("explicit-input", "Explicit amount 3: total 5; writes 2");

  const refused = await client.record(recordInput("deny"))({}, signal, Infinity);
  requireObservation(
    refused.isErr() &&
      "case" in refused.error &&
      refused.error.case === "Refused" &&
      refused.error.value.code === "blocked",
    "declared rejection was not reconstructed",
  );
  observed("declared-rejection", "Declared rejection: Refused / blocked");

  for (const [parameters, rule] of [
    ['{"label":"無効","amount":null}', "null"],
    ['{"label":"無効","amount":4}', "maximum"],
  ] as const) {
    const failure = await rejectedBoundary("record", parameters);
    requireObservation(
      failure.kind === "invalid-input" &&
        JSON.stringify(failure.violations) === JSON.stringify([{ path: "/amount", rule }]),
      "provider bypassed the generated boundary validation",
    );
  }
  observed(
    "invalid-boundary",
    "Untrusted null and out-of-range amount: rejected at /amount before handler entry",
  );
  requireObservation(
    (await rejectedBoundary("missing", "{}")).kind === "not-found",
    "unknown operation dispatched a handler",
  );
  observed("unknown-command", "Unknown command: not found rather than a successful operation");

  const state = await client.inspect(inspectInput())({}, signal, Infinity);
  requireObservation(
    state.isOk() &&
      state.value.value.total === 5 &&
      state.value.value.writes === 2 &&
      state.value.value.label === "明示",
    "rejected requests changed the committed state",
  );
  observed("state-unchanged", "After all refusals: total 5; writes 2; last label 明示");

  const held = Promise.resolve(client.record(recordInput("hold"))({}, signal, Infinity)).then(
    () => false,
    (failure: unknown) => failure instanceof DOMException && failure.name === "AbortError",
  );
  await invoke("lifecycle", { action: "held" });
  await invoke("lifecycle", { action: "stop" });
  requireObservation(await held, "stopping failed to cancel and drain the admitted request");
  observed(
    "in-flight-cancelled",
    "Stop during an admitted request: cancellation returned after host cleanup",
  );
  const stopped = await client.record(recordInput("停止"))({}, signal, Infinity);
  requireObservation(
    stopped.isErr() && "kind" in stopped.error && stopped.error.kind === "communication",
    "stopping host admitted another request",
  );
  observed("stopped", "After stopping: new request refused; no leaked active work");
}

try {
  await scenario();
  const status = document.querySelector("#status");
  if (status !== null)
    status.textContent = "PASS — generated TypeScript ↔ real Wry webview ↔ generated Rust provider";
  await invoke("finish", { checks, failure: null });
} catch (failure) {
  const message =
    failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure);
  const status = document.querySelector("#status");
  if (status !== null) status.textContent = `FAIL — ${message}`;
  await invoke("finish", { checks, failure: message });
}
