import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { environmentIdentity, stableEnvironment, verificationEnvironment } from "./environment.ts";
import { attemptCheck, invalidateReceipt, readReceipt, reusableReceipt } from "./evidence.ts";
import {
  checkInputs,
  dependencyFiles,
  digestFiles,
  digestValue,
  nativePackageIdentity,
  type Check,
} from "./inputs.ts";
import {
  checkCommand,
  commitChecks,
  nativeChecks,
  outputIdentity,
  reuseBlocker,
  testSuite,
} from "./plan.ts";
import { runCommand } from "./process.ts";
import { sandboxPrefix } from "./sandbox.ts";
import { sizeOf, suiteInventory, type Suite } from "./suites.ts";
import { tierSeconds, type Tier } from "./tier-budget.ts";
import { rustMinimumVersion } from "../../src/targets/rust/dependencies.ts";

/** Ignored local verification state */
const directory = "work/verification";
/** Whole-tier monotonic origin including Node startup and module loading */
const started = 0;
/** Unique local invocation provenance */
const invocation = `${Date.now()}-${process.pid}`;

/** Execution context shared by every check of one invocation */
interface Run {
  /** Public entry that started the invocation */
  readonly tier: Tier;
  /** Non-secret environment passed to every check */
  readonly env: NodeJS.ProcessEnv;
  /** Installed npm dependency fingerprint taken at invocation start */
  readonly dependencies: string;
  /** Whole-invocation resource ceiling */
  readonly seconds: number;
}

/** Inputs and identity of one check observed at one instant */
interface Snapshot {
  /** Files whose bytes enter the fingerprint */
  readonly inputs: readonly string[];
  /** Non-secret tool and platform identity */
  readonly environment: unknown;
  /** Wrapped check command without the caller's per-session temporary bind */
  readonly command: readonly string[];
  /** Fingerprint of command, environment, dependencies, caches and input bytes */
  readonly key: string;
}

/** Durable attempt record without credentials
 * @param event - Check or tier observation
 */
function record(event: unknown): void {
  mkdirSync(directory, { recursive: true });
  const line = {
    invocation,
    at: new Date().toISOString(),
    elapsedSeconds: performance.now() / 1_000,
    event,
  };
  appendFileSync(join(directory, "attempts.jsonl"), JSON.stringify(line) + "\n");
}

/** Remaining immutable whole-tier budget
 * @param seconds - Resource protection ceiling read at invocation start
 * @returns Remaining milliseconds
 * @throws {@link Error} Exhausted whole-tier budget
 */
function remaining(seconds: number): number {
  const milliseconds = seconds * 1_000 - (performance.now() - started);
  if (!(milliseconds > 0)) throw new Error(`Whole-tier ${seconds}s verification budget exhausted`);
  return milliseconds;
}

/** Rust release that the canonical push entry proves, which the explicit full test run does not require
 * @param run - Invocation context
 * @returns Exported Rust floor under `verify:push`, otherwise no exact requirement
 */
function exactRustRelease(run: Run): string | undefined {
  return run.tier === "verify:push" ? rustMinimumVersion : undefined;
}

/** Command identity and current check inputs
 * @param check - Selected acceptance check
 * @param run - Invocation context
 * @returns Complete input snapshot
 */
function snapshot(check: Check, run: Run): Snapshot {
  const inputs = checkInputs(check, run.env);
  const environment = environmentIdentity(check, run.env, exactRustRelease(run));
  const command = checkCommand(check, stableEnvironment(run.env));
  const packages = nativePackageIdentity(check, run.env);
  const files = digestFiles(inputs);
  const key = digestValue({
    command,
    environment,
    dependencies: run.dependencies,
    packages,
    files,
  });
  return { inputs, environment, command, key };
}

/** Resource isolation preflight inside the exact runner wrapper
 * @param suite - Test collection about to execute
 * @param run - Invocation context
 * @throws {@link Error} Runner that does not deny its forbidden resources
 */
async function verifySandbox(suite: Suite, run: Run): Promise<void> {
  const size = sizeOf(suite);
  const command = [
    ...sandboxPrefix(size, run.env),
    process.execPath,
    "scripts/verification/sandbox-probe.ts",
    size,
  ];
  const outcome = await runCommand(command, run.env, remaining(run.seconds));
  record({
    check: suite,
    state: "sandbox",
    size,
    status: outcome.status,
    seconds: outcome.seconds,
  });
  if (outcome.status !== 0 || outcome.signal !== null)
    throw new Error(
      `${size} runner isolation preflight failed for ${suite}: status ${outcome.status}`,
    );
}

/** Execution of one check whose evidence is missing, changed or not reusable
 * @param check - Selected acceptance check
 * @param run - Invocation context
 * @param before - Input snapshot taken before execution
 */
async function executeCheck(check: Check, run: Run, before: Snapshot): Promise<void> {
  const report = join(directory, `${check}.${invocation}.tests.json`);
  const receipt = await attemptCheck(directory, check, async () => {
    rmSync(report, { force: true });
    record({ check, state: "started", key: before.key, command: before.command });
    const suite = testSuite(check);
    if (suite !== undefined) await verifySandbox(suite, run);
    const exactMinimum = suite === "rust" && exactRustRelease(run) !== undefined;
    const selection =
      suite === undefined
        ? {}
        : {
            CONTRACT_TEST_SUITE: suite,
            CONTRACT_TEST_REPORT: report,
            ...(exactMinimum ? { RUST_CONTRACT_EXACT_MINIMUM: "1" } : {}),
          };
    const executed = checkCommand(check, run.env);
    const outcome = await runCommand(
      executed,
      { ...run.env, ...selection },
      remaining(run.seconds),
    );
    if (outcome.status !== 0 || outcome.signal !== null)
      throw new Error(`${check} failed: status ${outcome.status}; signal ${outcome.signal}`);
    const tests: unknown = suite === undefined ? null : JSON.parse(readFileSync(report, "utf8"));
    rmSync(report, { force: true });
    if (snapshot(check, run).key !== before.key)
      throw new Error(`${check} inputs changed during execution; pass evidence not published`);
    remaining(run.seconds);
    return {
      version: 1,
      check,
      key: before.key,
      result: "passed",
      command: before.command,
      inputs: before.inputs,
      environment: before.environment,
      dependencies: run.dependencies,
      completedAt: new Date().toISOString(),
      seconds: outcome.seconds,
      tests,
      output: outputIdentity(check),
    };
  });
  record({ check, state: "passed", key: receipt.key, seconds: receipt.seconds });
}

/** One required check with reuse only for matching evidence and no automatic retry
 * @param check - Selected acceptance check
 * @param run - Invocation context
 */
async function verifyCheck(check: Check, run: Run): Promise<void> {
  remaining(run.seconds);
  const before = snapshot(check, run);
  const blocker = run.tier === "test" ? "explicit full test run" : reuseBlocker(check, run.env);
  const receipt = readReceipt(directory, check);
  if (blocker === undefined && reusableReceipt(receipt, check, before.key, outputIdentity(check))) {
    record({ check, state: "reused", key: before.key });
    console.log(`[verify] reuse ${check}: identical inputs, dependencies, command and environment`);
    return;
  }
  console.log(`[verify] run ${check}: ${blocker ?? "missing or changed evidence"}`);
  await executeCheck(check, run, before);
}

/** Checks required by a public entry
 * @param tier - Public entry
 * @returns Ordered checks
 */
function tierChecks(tier: Tier): readonly Check[] {
  if (tier === "verify") return commitChecks;
  if (tier === "verify:push") return [...commitChecks, ...nativeChecks];
  return [
    "build",
    ...commitChecks.filter((check) => testSuite(check) !== undefined),
    ...nativeChecks,
  ];
}

/** Required acceptance entry with reuse restricted to matching local evidence
 * @throws {@link Error} Unknown entry, missing budget, failed check or dependency drift
 */
async function main(): Promise<void> {
  const tier = process.argv[2];
  if (tier !== "verify" && tier !== "verify:push" && tier !== "test")
    throw new Error("Expected verify, verify:push or test");
  const seconds = tierSeconds(readFileSync("tiergate.json", "utf8"), tier);
  const env = verificationEnvironment();
  const dependencies = digestFiles(dependencyFiles("node_modules"));
  const run: Run = { tier, env, dependencies, seconds };
  const checks = tierChecks(tier);
  record({ tier, state: "started", seconds, checks, inventory: suiteInventory() });
  const published: Check[] = [];
  try {
    for (const check of checks) {
      await verifyCheck(check, run);
      published.push(check);
    }
    if (dependencies !== digestFiles(dependencyFiles("node_modules")))
      throw new Error("Installed verifier dependencies changed during the tier");
    remaining(seconds);
    record({ tier, state: "passed" });
  } catch (error) {
    if (dependencies !== digestFiles(dependencyFiles("node_modules")))
      for (const check of published) invalidateReceipt(directory, check);
    throw error;
  }
}

try {
  await main();
} catch (error) {
  record({
    state: "failed-or-interrupted",
    message: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exitCode = 1;
}
