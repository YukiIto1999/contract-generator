/** Failure vocabulary, host hooks and payload helpers of the generated provider module */
export const providerCoreSource = String.raw`/** Expected invalid external provider input */
export interface InvalidInput {
  /** Failure classification */
  readonly kind: "invalid-input";
  /** Located contract rule failures without received values */
  readonly violations: readonly C.Violation[];
  /** Unknown member locations without received values */
  readonly diagnostics: readonly C.Diagnostic[];
}

/** Expected absence of an operation route or command */
export interface NotFound {
  /** Failure classification */
  readonly kind: "not-found";
}

/** Complete inbound request reader with host failure ownership */
export type RequestBodyReader = (request: Request, context: C.CallContext) => AsyncResult<Uint8Array, C.CommunicationFailure>;

/** Provider collaborators shared by every generated operation function */
interface ProviderParts<Env> {
  /** Handwritten application adapters */
  readonly handlers: Handlers<Env>;
  /** Host-owned body reading and failure classification */
  readonly readBody: RequestBodyReader;
}

/**
 * Typed rejection of untrusted provider input
 * @param violations - Located contract rule failures
 * @param diagnostics - Unknown member locations from rejected input
 * @returns Expected inbound failure without handler dispatch
 */
function invalidInput(violations: readonly C.Violation[], diagnostics: readonly C.Diagnostic[] = []): Err<InvalidInput> {
  return Err({ kind: "invalid-input", violations, diagnostics });
}

/**
 * Binding representation of a handler payload after contract validation
 * @typeParam T - Payload type
 * @param codec - Outcome payload codec
 * @param value - Handler payload
 * @param binding - Binding interpretation
 * @returns Validated wire representation
 * @throws {@link C.ContractDefect} Payload that violates the contract
 */
function wirePayload<T>(codec: C.Codec<T>, value: T, binding: C.WireBinding): unknown {
  const encoded = codec.toWire(value, binding);
  if (encoded.isErr()) throw new C.ContractDefect("Invalid handler output", encoded.error);
  return encoded.value;
}

/**
 * Raw bytes of a handler payload after contract validation
 * @param codec - Bytes payload codec
 * @param value - Handler payload
 * @returns Independent copy of the validated bytes
 * @throws {@link C.ContractDefect} Payload that violates the contract
 */
function rawPayload(codec: C.Codec<C.ByteSequence>, value: C.ByteSequence): Uint8Array<ArrayBuffer> {
  const checked = codec.create(value);
  if (checked.isErr()) throw new C.ContractDefect("Invalid handler output", checked.error.violations);
  return checked.value.value.toUint8Array();
}

/**
 * Validated owned payload of a handler result
 * @typeParam T - Payload type
 * @param codec - Outcome payload codec
 * @param value - Handler payload
 * @returns Owned immutable payload
 * @throws {@link C.ContractDefect} Payload that violates the contract
 */
function checkedPayload<T>(codec: C.Codec<T>, value: T): T {
  const checked = codec.create(value);
  if (checked.isErr()) throw new C.ContractDefect("Invalid handler output", checked.error.violations);
  return checked.value.value;
}
`;

/** Failure union and request helpers used only by operations published over HTTP */
export const providerHttpSource = String.raw`/** Expected failures of inbound HTTP handling */
export type HttpFailure = InvalidInput | NotFound | C.CommunicationFailure;

/** How a placed parameter value is read from the request */
interface Placement {
  /** Whether the wire value is the text itself rather than a JSON token */
  readonly text: boolean;
  /** Whether the text is percent-encoded */
  readonly encoded: boolean;
}

/**
 * Media type without parameters in canonical case
 * @param value - Content-Type header value
 * @returns Case-insensitive essence, absent without a header
 */
function essence(value: string | null): string | undefined {
  return value?.split(";")[0]?.trim().toLowerCase();
}

/**
 * Request body bytes after media type verification
 * @param parts - Provider collaborators
 * @param request - Host request
 * @param context - Host cancellation and deadline
 * @param mediaType - Declared request media type
 * @returns Complete body or the typed inbound failure
 */
async function requestBytes<Env>(parts: ProviderParts<Env>, request: Request, context: C.CallContext, mediaType: string): Promise<Result<Uint8Array, InvalidInput | C.CommunicationFailure>> {
  if (essence(request.headers.get("content-type")) !== mediaType) return invalidInput([{ path: "", rule: "format" }]);
  return await parts.readBody(request, context);
}

/**
 * RFC 6901 location of a body member
 * @param member - Unescaped member name
 * @returns Pointer to the member of the body object
 */
function memberPointer(member: string): string {
  return "/" + member.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Body members that duplicate a parameter placed in the path, query or header
 * @param parameters - Wire parameter object assembled from the body
 * @param members - Wire member names of the placed parameters
 * @returns Unknown-member diagnostics of the dropped members; the placed value is never overwritten
 */
function dropPlacedMembers(parameters: Record<string, unknown>, members: readonly string[]): readonly C.Diagnostic[] {
  const dropped: C.Diagnostic[] = [];
  for (const member of members) {
    if (!Object.hasOwn(parameters, member)) continue;
    delete parameters[member];
    dropped.push(Object.freeze({ path: "", key: member }));
  }
  return dropped;
}

/**
 * Percent-decoded path segment
 * @param raw - Encoded segment
 * @returns Decoded text or absence for malformed escapes
 * @throws {@link Error} Failure that is not a malformed escape
 */
function percentDecoded(raw: string): string | undefined {
  const decoded = Result.wrap<string, unknown>(() => decodeURIComponent(raw)).mapErr((cause) => {
    if (cause instanceof URIError) return cause;
    throw cause;
  });
  return decoded.isOk() ? decoded.value : undefined;
}

/**
 * Placement of a received parameter value into the wire parameter object
 * @param parameters - Wire parameter object under construction
 * @param member - Wire member name of the input parameter
 * @param raw - Received text, absent when the request omits the parameter
 * @param placement - How the value is read
 * @returns Violations of a malformed value, absent when the value is placed or omitted
 */
function placeParameter(parameters: Record<string, unknown>, member: string, raw: string | null | undefined, placement: Placement): readonly C.Violation[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  const text = placement.encoded ? percentDecoded(raw) : raw;
  if (text === undefined) return [{ path: memberPointer(member), rule: "format" }];
  if (placement.text) {
    parameters[member] = text;
    return undefined;
  }
  const parsed = C.parseJson(text);
  if (parsed.isErr()) return parsed.error.map((violation) => ({ path: memberPointer(member) + violation.path, rule: violation.rule }));
  parameters[member] = parsed.value;
  return undefined;
}
`;
