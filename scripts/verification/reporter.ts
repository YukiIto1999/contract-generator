import { writeFileSync } from "node:fs";
import { relative } from "node:path";
import type { Reporter, TestModule } from "vite-plus/test/node";
import { selectedSuites } from "./suites.ts";

/** Required test result manifest */
export interface TestEvidence {
  /** Checkout-relative test modules that completed */
  readonly modules: readonly string[];
  /** Passed native test identities without duplicates */
  readonly ids: readonly string[];
}

/** Complete passing native test identities
 * @param modules - Final native runner modules
 * @param expected - Exact selected module paths
 * @returns Passing native test identity manifest
 * @throws {@link Error} Missing module or incomplete test result
 */
export function completeResults(
  modules: readonly TestModule[],
  expected: readonly string[],
): TestEvidence {
  const actual = modules.map((module) => module.relativeModuleId).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort()))
    throw new Error(
      `Test module discovery mismatch: actual ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`,
    );
  const ids: string[] = [];
  for (const module of modules) {
    const tests = [...module.children.allTests()];
    if (!module.ok() || tests.length === 0)
      throw new Error(`Incomplete test module: ${module.moduleId}`);
    for (const test of tests) {
      if (test.result().state !== "passed")
        throw new Error(
          `Required test ${test.id} ${test.fullName}: ${test.result().state}; expected passed`,
        );
      ids.push(test.id);
    }
  }
  if (ids.length === 0 || new Set(ids).size !== ids.length)
    throw new Error("Native test identities must be nonempty and unique");
  return { modules: actual, ids: ids.sort() };
}

/** Required acceptance completeness reporter */
export default class AcceptanceReporter implements Reporter {
  /** Exact native discovery for an explicitly focused module run */
  private expected: string[] = [];

  /** Native discovery capture before execution */
  onTestRunStart: NonNullable<Reporter["onTestRunStart"]> = (specifications) => {
    this.expected = specifications.map((specification) =>
      relative(process.cwd(), specification.moduleId),
    );
  };

  /** Complete acceptance result without skipped required native identities */
  onTestRunEnd: NonNullable<Reporter["onTestRunEnd"]> = (modules, errors, reason) => {
    if (reason !== "passed" || errors.length !== 0)
      throw new Error(`Acceptance did not pass: ${reason}; unhandled errors: ${errors.length}`);
    const required =
      process.env.CONTRACT_TEST_SUITE !== undefined ||
      process.env.CONTRACT_TEST_REPORT !== undefined;
    const expected = required ? selectedSuites(process.env.CONTRACT_TEST_SUITE) : this.expected;
    const evidence = completeResults(modules, expected);
    const destination = process.env.CONTRACT_TEST_REPORT;
    if (destination !== undefined) writeFileSync(destination, JSON.stringify(evidence));
    console.log(
      `[acceptance] ${evidence.modules.length} modules; ${evidence.ids.length} passed native test IDs; no skips`,
    );
  };
}
