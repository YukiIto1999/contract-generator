import type {
  Envelope,
  RecordId,
  RequestId,
  ShortLabel,
  SubmitAcceptedInput,
  SubmitInput,
} from "./contract.js";

/** Compile-time public role and presence proof without unchecked construction
 * @param request - First role
 * @param record - Different role with the same primitive representation
 * @param envelope - Public immutable graph
 * @param accepted - Stronger effective handler input
 * @param input - Preacceptance input
 * @returns Accepted same-role alias references
 */
export function roleAndPresenceProof(
  request: RequestId,
  record: RecordId,
  envelope: Envelope,
  accepted: SubmitAcceptedInput,
  input: SubmitInput,
): RequestId {
  const correlation: Envelope["correlationId"] = request;
  // @ts-expect-error Distinct same-representation roles remain incompatible
  const wrongRequest: RequestId = record;
  // @ts-expect-error Distinct same-representation roles remain incompatible
  const wrongRecord: RecordId = request;
  // @ts-expect-error Public object fields remain readonly
  envelope.label = "x" as ShortLabel;
  // @ts-expect-error Exact optional properties reject explicitly undefined values
  const undefinedOptional: Pick<Envelope, "optionalText"> = { optionalText: undefined };
  // @ts-expect-error Optional nonnullable values reject explicit null
  const nullOptional: Pick<Envelope, "optionalText"> = { optionalText: null };
  // @ts-expect-error Client input retains omission before provider acceptance
  const prematurelyEffective: SubmitAcceptedInput = input;
  const limit: number = accepted.limit;
  const ordinaryConstraintAlias: ShortLabel = "😀";
  void wrongRequest;
  void wrongRecord;
  void undefinedOptional;
  void nullOptional;
  void prematurelyEffective;
  void limit;
  void ordinaryConstraintAlias;
  return correlation;
}
