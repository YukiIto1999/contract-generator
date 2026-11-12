/** Transport contracts and the bundled Fetch transport of the generated client module */
export const transportSource = String.raw`/** Host-supplied HTTP I/O with typed expected failures */
export interface HttpTransport {
  /**
   * HTTP exchange without generated retry or timeout
   * @param request - Complete request carrying the host cancellation signal
   * @param context - Host cancellation and deadline
   * @returns Response headers or expected communication failure
   */
  request(request: Request, context: C.CallContext): AsyncResult<Response, C.CommunicationFailure>;
  /**
   * Complete response ownership including truncation failures
   * @param response - Received response
   * @param context - Host cancellation and deadline
   * @returns Complete owned bytes or expected communication failure
   */
  readBody(response: Response, context: C.CallContext): AsyncResult<Uint8Array, C.CommunicationFailure>;
}

/** Host IPC transport preserving exact numeric JSON across process boundaries */
export interface IpcTransport {
  /**
   * Command exchange over the host mechanism
   * @param command - Binding command
   * @param parametersJson - Exact JSON operation parameters
   * @param context - Host cancellation and deadline
   * @returns Complete exact JSON response or expected communication failure
   */
  request(command: string, parametersJson: string, context: C.CallContext): AsyncResult<string, C.CommunicationFailure>;
}

/** Host origin and injected HTTP I/O of an HTTP client */
export interface HttpClientOptions {
  /** Service origin that absolute route templates are relative to */
  readonly baseUrl: string;
  /** Injected HTTP exchange */
  readonly transport: HttpTransport;
}

/** Injected IPC mechanism of an IPC client */
export interface IpcClientOptions {
  /** Injected command exchange */
  readonly transport: IpcTransport;
}

/**
 * Error mapper of native Fetch failures
 * @param cause - Native I/O rejection
 * @returns Expected communication failure for network and truncation failures
 * @throws {@link Error} Host cancellation, interruption and every other defect, unchanged
 */
function toCommunicationFailure(cause: unknown): C.CommunicationFailure {
  if (cause instanceof TypeError) return { kind: "communication", message: "HTTP communication did not complete" };
  throw cause;
}

/**
 * Real Fetch integration that forwards the host cancellation signal and adds no timer
 * @param fetcher - Host HTTP implementation
 * @returns HTTP transport with complete response reads; defects and cancellation reject the awaited result
 */
export function createFetchTransport(fetcher: typeof fetch): HttpTransport {
  return {
    request: (request, context) =>
      new AsyncResult(
        Result.wrapAsync<Response, unknown>(() => fetcher(request, { signal: context.signal })).then((received) =>
          received.mapErr(toCommunicationFailure),
        ),
      ),
    readBody: (response) =>
      new AsyncResult(
        Result.wrapAsync<Uint8Array, unknown>(async () => new Uint8Array(await response.arrayBuffer())).then((received) =>
          received.mapErr(toCommunicationFailure),
        ),
      ),
  };
}
`;

export const payloadSource = String.raw`/** Contract mismatch classification of a received response or message */
type Mismatch = (violations: readonly C.Violation[]) => Result<never, C.CommunicationFailure>;

/**
 * Payload acceptance of a selected result
 * @typeParam T - Payload type
 * @param codec - Outcome payload codec
 * @param body - Wire body of the selected result
 * @param binding - Binding interpretation
 * @param mismatch - Contract mismatch classification
 * @returns Accepted payload or the classified mismatch
 */
function payload<T>(codec: C.Codec<T>, body: unknown, binding: C.WireBinding, mismatch: Mismatch): Result<T, C.CommunicationFailure> {
  const decoded = codec.fromWire(body, binding);
  return decoded.isErr() ? mismatch(decoded.error) : Ok(decoded.value.value);
}
`;

/** Helpers used only by operations published over HTTP */
export const httpHelperSource = String.raw`/**
 * Media type without parameters in canonical case
 * @param value - Content-Type header value
 * @returns Case-insensitive essence, absent without a header
 */
function essence(value: string | null): string | undefined {
  return value?.split(";")[0]?.trim().toLowerCase();
}

/**
 * Classification of a response that does not match a declared result
 * @param status - Response status
 * @param violations - Contract rule failures
 * @returns Communication failure for an intermediary status
 * @throws {@link C.ContractDefect} Mismatch of any other response
 */
function httpMismatch(status: number, violations: readonly C.Violation[]): Result<never, C.CommunicationFailure> {
  if (status === 502 || status === 503 || status === 504)
    return Err<C.CommunicationFailure>({ kind: "communication", message: "Intermediary response does not match a declared rejection" });
  throw new C.ContractDefect("HTTP response violates contract", violations);
}

/**
 * Release of an unread response body without observing its failure
 * @param response - Response already classified as a mismatch
 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is classified; the release outcome carries no further meaning.
  }
}

/**
 * Response body of a result without payload
 * @param bytes - Complete response body
 * @returns The absent payload, or a violation for any body
 */
function absentBody(bytes: Uint8Array): Result<unknown, readonly C.Violation[]> {
  return bytes.length === 0 ? Ok(undefined) : Err([{ path: "", rule: "type" }]);
}

/**
 * Wire text of a parameter value
 * @param wire - Wire representation of the input
 * @param member - Wire member name of the parameter
 * @returns Text or JSON token of the value, absent for an omitted optional parameter
 * @throws {@link C.ContractDefect} Representation without a JSON document
 */
function wireText(wire: Record<string, unknown>, member: string): string | undefined {
  if (!Object.hasOwn(wire, member)) return undefined;
  const encoded = wire[member];
  return typeof encoded === "string" ? encoded : C.stringifyJson(encoded);
}

/**
 * Placement of a present parameter value into query parameters or headers
 * @param target - Query parameters or headers
 * @param name - Parameter name on the wire
 * @param wire - Wire representation of the input
 * @param member - Wire member name of the parameter
 * @throws {@link C.ContractDefect} Representation without a JSON document
 */
function placeValue(target: { append(name: string, value: string): void }, name: string, wire: Record<string, unknown>, member: string): void {
  const text = wireText(wire, member);
  if (text !== undefined) target.append(name, text);
}
`;

/** Helpers used only by operations published over IPC */
export const ipcHelperSource = String.raw`/**
 * Contract mismatch of an IPC response
 * @param violations - Contract rule failures
 * @returns Never returns
 * @throws {@link C.ContractDefect} Every IPC mismatch is a defect
 */
function ipcMismatch(violations: readonly C.Violation[]): never {
  throw new C.ContractDefect("IPC response violates contract", violations);
}

/**
 * IPC response envelope reading
 * @param text - Complete JSON response
 * @returns Envelope members including the result tag and the optional body
 * @throws {@link C.ContractDefect} Response that is not an envelope object
 */
function readIpcEnvelope(text: string): Readonly<Record<string, unknown>> {
  const envelope = C.parseJson(text).andThen(C.jsonObject);
  if (envelope.isErr()) throw new C.ContractDefect("Invalid IPC response", envelope.error);
  return envelope.value;
}
`;
