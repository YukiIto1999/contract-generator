import { readFileSync } from "node:fs";
import { expect } from "vite-plus/test";
import { compareText } from "../../../src/model/ordering.js";
import { runDriver } from "./csharp-process.js";

/** Native fixture case independent of emitter implementation */
export interface NativeCase {
  /** Public driver input; `payloadUnits` carries UTF-16 code units that JSON text could not hold */
  input: Record<string, string | readonly number[]>;
  /** Expected acceptance */
  accepted: boolean;
  /** Expected JSON value */
  encoded?: string;
  /** Exact token spellings that must appear in the encoded text, which JSON.parse could not distinguish */
  encodedContains?: readonly string[];
  /** Expected positioned rules */
  violations?: readonly { path: string; rule: string }[];
  /** Expected unknown names */
  diagnostics?: readonly { path: string; key: string }[];
}

/** Order-independent rendering of positioned observations
 * @param entries - Violations or unknown-name diagnostics
 * @returns Sorted comparable values
 */
export function canonical<T extends object>(entries: readonly T[] | undefined): readonly string[] {
  return (entries ?? [])
    .map((entry) =>
      JSON.stringify(Object.entries(entry).sort(([left], [right]) => compareText(left, right))),
    )
    .sort();
}

/** Comparing real driver observations with contract-derived expectations
 * @param driver - Built driver assembly speaking the codec protocol
 * @param cases - Expectations written from the contract, never from generated output
 * @returns Native public-boundary observations
 */
export async function observeCodecCases(
  driver: string,
  cases: readonly NativeCase[],
): Promise<readonly Record<string, unknown>[]> {
  const observations = await runDriver(
    driver,
    cases.map((entry) => entry.input),
  );
  cases.forEach((entry, index) => {
    const observation = observations[index]!;
    const label = JSON.stringify(entry.input);
    expect(observation.accepted, label).toBe(entry.accepted);
    expect(canonical(observation.violations as never), label).toEqual(canonical(entry.violations));
    expect(canonical(observation.diagnostics as never), label).toEqual(
      canonical(entry.diagnostics),
    );
    if (entry.encoded !== undefined)
      expect(JSON.parse(observation.encoded as string), label).toEqual(JSON.parse(entry.encoded));
    else expect("encoded" in observation, label).toBe(entry.accepted);
    for (const token of entry.encodedContains ?? [])
      expect(observation.encoded, label).toContain(token);
  });
  return observations;
}

/** Fixture JSON file independent of the generated code
 * @param name - File name inside the fixture directory
 * @returns Parsed content
 */
function fixtureJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/csharp/${name}`, import.meta.url), "utf8"),
  ) as T;
}

/** Executing a built real generated codec driver against the independent Sample codec expectations
 * @param driver - Built CodecDriver.dll path
 * @returns Native public-boundary observations
 */
export function observeCSharpCodecCases(
  driver: string,
): Promise<readonly Record<string, unknown>[]> {
  return observeCodecCases(driver, fixtureJson<NativeCase[]>("codec-cases.json"));
}

/** Presence fixture scenario independent of generated validation */
interface PresenceCase {
  /** Consumer-visible scenario name */
  name: string;
  /** Generated construction or codec boundary */
  type?: string;
  /** Omitted source fields */
  omit?: readonly string[];
  /** Source JSON field replacements */
  set?: Readonly<Record<string, unknown>>;
  /** Factory label override */
  label?: string;
  /** Factory numeric override */
  count?: number;
  /** Construction with the zero-valued request role */
  defaultRequestId?: boolean;
  /** Construction with a null item collection */
  nullItems?: boolean;
  /** Contract-derived expectation */
  accepted: boolean;
  /** Expected positioned violations */
  violations?: readonly { path: string; rule: string }[];
  /** Expected unknown names */
  diagnostics?: readonly { path: string; key: string }[];
}

/** Valid complete Envelope wire value shared by operation scenarios
 * @returns Fresh baseline object from the presence fixture
 */
export function baselineEnvelope(): Record<string, unknown> {
  return fixtureJson<{ baseline: Record<string, unknown> }>("presence-cases.json").baseline;
}

/** Driver request of one presence scenario
 * @param baseline - Baseline Envelope wire value
 * @param entry - Scenario
 * @returns Codec-protocol request
 */
function presenceRequest(
  baseline: Record<string, unknown>,
  entry: PresenceCase,
): Record<string, unknown> {
  const payload = { ...structuredClone(baseline), ...entry.set };
  for (const key of entry.omit ?? []) delete payload[key];
  return {
    type: entry.type ?? "Envelope",
    payload: JSON.stringify(payload),
    ...(entry.label === undefined ? {} : { label: entry.label }),
    ...(entry.count === undefined ? {} : { count: entry.count }),
    ...(entry.defaultRequestId === undefined ? {} : { defaultRequestId: entry.defaultRequestId }),
    ...(entry.nullItems === undefined ? {} : { nullItems: entry.nullItems }),
  };
}

/** Ownership and presence expectations of an accepted presence scenario
 * @param observation - Native observation
 * @param entry - Scenario
 * @param baseline - Baseline Envelope wire value
 */
function expectAcceptedShape(
  observation: Record<string, unknown>,
  entry: PresenceCase,
  baseline: Record<string, unknown>,
): void {
  expect(observation.encoded).not.toContain("must-not-appear");
  const encoded = JSON.parse(observation.encoded as string) as Record<string, unknown>;
  if (entry.set && "optionalNullable" in entry.set)
    expect(encoded.optionalNullable, entry.name).toBeNull();
  else expect("optionalNullable" in encoded, entry.name).toBe(false);
  expect("optionalText" in encoded, entry.name).toBe(false);
  expect(encoded.items, entry.name).toEqual(baseline.items);
  expect(encoded.amount, entry.name).toBe(baseline.amount);
  expect(encoded.occurredAt, entry.name).toBe(baseline.occurredAt);
}

/** Real generated presence and ownership regression
 * @param driver - Built CodecDriver.dll path
 * @returns Native public-boundary observations
 */
export async function observeCSharpPresenceCases(
  driver: string,
): Promise<readonly Record<string, unknown>[]> {
  const fixture = fixtureJson<{ baseline: Record<string, unknown>; cases: PresenceCase[] }>(
    "presence-cases.json",
  );
  const observations = await runDriver(
    driver,
    fixture.cases.map((entry) => presenceRequest(fixture.baseline, entry)),
  );
  fixture.cases.forEach((entry, index) => {
    const observation = observations[index]!;
    expect(observation.accepted, entry.name).toBe(entry.accepted);
    expect(canonical(observation.violations as never), entry.name).toEqual(
      canonical(entry.violations),
    );
    expect(canonical(observation.diagnostics as never), entry.name).toEqual(
      canonical(entry.diagnostics),
    );
    if (entry.accepted) expectAcceptedShape(observation, entry, fixture.baseline);
    else expect("encoded" in observation, entry.name).toBe(false);
  });
  return observations;
}
