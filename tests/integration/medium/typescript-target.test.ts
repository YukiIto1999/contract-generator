import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, expect, test } from "vite-plus/test";
import { consumerChecks, numericChecks, sourceDataChecks } from "./typescript-checks.js";
import {
  cleanup,
  contractProject,
  documentationLines,
  evaluateModule,
  numericProject,
  reportedChecks,
  sourceDataProject,
  typecheck,
  type CheckLine,
} from "./typescript-harness.js";
import {
  declarations,
  fenceOneLine,
  flavorValues,
  lookalikes,
  memberBreaks,
  oneLine,
  pickJson,
  specimenJson,
} from "./hostile-source.js";

/** Generous bound for compiling a generated project and running its real socket and process peers */
const projectTimeout = 300_000;

/** Shared generated contract project, built once by the first test that needs it */
let contract: Promise<string> | undefined;
/** Result lines of the shared consumer program */
let consumer: Promise<ReadonlyMap<string, CheckLine>> | undefined;
/** Result lines of the numeric consumer program */
let numeric: Promise<ReadonlyMap<string, CheckLine>> | undefined;
/** Type-checked source-data project, built once by the first test that needs it */
let sourceData: Promise<string> | undefined;
/** Result lines of the source-data consumer program */
let sourceDataReport: Promise<ReadonlyMap<string, CheckLine>> | undefined;

/**
 * Type-checked shared contract project
 * @returns Project root directory
 */
function contractRoot(): Promise<string> {
  return (contract ??= contractProject());
}

/**
 * Result lines of the shared consumer program run against real sockets and a separate process
 * @returns Reported checks by name
 */
function consumerLines(): Promise<ReadonlyMap<string, CheckLine>> {
  return (consumer ??= contractRoot().then((root) =>
    reportedChecks(join(root, "dist/driver.js"), ["self-test"]),
  ));
}

/**
 * Result lines of the numeric consumer program
 * @returns Reported checks by name
 */
function numericLines(): Promise<ReadonlyMap<string, CheckLine>> {
  return (numeric ??= numericProject().then((root) =>
    reportedChecks(join(root, "dist/numeric-consumer.js"), []),
  ));
}

/**
 * Type-checked source-data project
 * @returns Project root directory
 */
function sourceDataRoot(): Promise<string> {
  return (sourceData ??= sourceDataProject());
}

/**
 * Result lines of the source-data consumer program, given the contract-derived expectations
 * @returns Reported checks by name
 */
function sourceDataLines(): Promise<ReadonlyMap<string, CheckLine>> {
  return (sourceDataReport ??= sourceDataRoot().then((root) =>
    reportedChecks(join(root, "dist/source-data-consumer.js"), [
      JSON.stringify({ flavorValues, lookalikes, specimenJson, pickJson }),
    ]),
  ));
}

afterAll(cleanup);

test(
  "the generated consumer project type-checks against the real compiler",
  async () => {
    await contractRoot();
  },
  projectTimeout,
);

test(
  "pure types and codecs compile and execute without an Effect module dependency",
  async () => {
    const root = await contractRoot();
    await typecheck(root, "codec-tsconfig.json");
    expect(await evaluateModule(root, "pure-dist/codec-only.js", "m.pureCodecConsumer()")).toBe(
      '"😀"',
    );
  },
  projectTimeout,
);

test(
  "the common JSON-lines observation protocol returns diagnostics without retaining unknown values",
  async () => {
    const root = await contractRoot();
    const payload =
      '{"requestId":"00000000-0000-0000-0000-000000000001","recordId":"00000000-0000-0000-0000-000000000002","correlationId":"00000000-0000-0000-0000-000000000003","label":"😀","count":1,"amount":"1.000","occurredAt":"2016-12-31T23:59:60.123456789012345Z","nullableText":null,"items":[{"kind":"text","text":"A","future":"not retained"}]}';
    const output = execFileSync(process.execPath, [join(root, "dist/driver.js"), "codec"], {
      input: JSON.stringify({ type: "Envelope", payload }) + "\n",
      encoding: "utf8",
      timeout: 30_000,
    });
    const result = JSON.parse(output) as {
      accepted: boolean;
      encoded: string;
      diagnostics: unknown[];
    };
    expect(result.accepted).toBe(true);
    expect(result.diagnostics).toEqual([{ path: "/items/0", key: "future" }]);
    expect(result.encoded).not.toContain("not retained");
  },
  projectTimeout,
);

test.each(consumerChecks)(
  "consumer: %s",
  async (name) => {
    const reported = (await consumerLines()).get(name);
    expect(reported, "the consumer program reported the check").toBeDefined();
    expect(reported?.detail).toBeUndefined();
    expect(reported?.passed).toBe(true);
  },
  projectTimeout,
);

test(
  "the consumer program reports exactly the expected checks",
  async () => {
    expect([...(await consumerLines()).keys()].sort()).toEqual([...consumerChecks].sort());
  },
  projectTimeout,
);

test.each(numericChecks)(
  "numeric consumer: %s",
  async (name) => {
    const reported = (await numericLines()).get(name);
    expect(reported, "the numeric consumer program reported the check").toBeDefined();
    expect(reported?.detail).toBeUndefined();
    expect(reported?.passed).toBe(true);
  },
  projectTimeout,
);

test(
  "the numeric consumer program reports exactly the expected checks",
  async () => {
    expect([...(await numericLines()).keys()].sort()).toEqual([...numericChecks].sort());
  },
  projectTimeout,
);

test(
  "the generated source-data project type-checks, so no description, name or tag leaves its place",
  async () => {
    await sourceDataRoot();
  },
  projectTimeout,
);

test(
  "keeps every description on one documentation line",
  async () => {
    const lines = await documentationLines(await sourceDataRoot());
    for (const [label, kind] of declarations) expect(lines, label).toContain(oneLine(label, kind));
    for (const label of memberBreaks) expect(lines, label).toContain(oneLine(label));
    expect(lines).toContain(fenceOneLine);
  },
  projectTimeout,
);

test.each(sourceDataChecks)(
  "source-data consumer: %s",
  async (name) => {
    const reported = (await sourceDataLines()).get(name);
    expect(reported, "the source-data consumer program reported the check").toBeDefined();
    expect(reported?.detail).toBeUndefined();
    expect(reported?.passed).toBe(true);
  },
  projectTimeout,
);

test(
  "the source-data consumer program reports exactly the expected checks",
  async () => {
    expect([...(await sourceDataLines()).keys()].sort()).toEqual([...sourceDataChecks].sort());
  },
  projectTimeout,
);
