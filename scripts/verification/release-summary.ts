import { rustRelease } from "./environment.ts";
import type { Check } from "./inputs.ts";
import { commitChecks, nativeChecks, testSuite } from "./plan.ts";

/** What the summary reads of a stored passing receipt */
interface SummarizedReceipt {
  /** Passed native test identities and completed modules, or no tests for a static check */
  readonly tests: { readonly modules: readonly string[]; readonly ids: readonly string[] } | null;
  /** Tool and platform identity of the check */
  readonly environment: {
    readonly node: string;
    readonly tools: Readonly<Record<string, string>>;
  };
}

/** Whether a stored value is a passing receipt of the check that the summary names
 * @param check - Check whose receipt is required
 * @param value - Stored JSON
 * @returns The receipt, narrowed to what the summary reads
 * @throws {@link Error} A missing receipt, a receipt of another check or of a failure, and a collection that passed no test
 */
function passingReceipt(check: Check, value: unknown): SummarizedReceipt {
  const receipt = value as
    | (Partial<SummarizedReceipt> & { check?: unknown; result?: unknown })
    | undefined;
  if (receipt?.check !== check || receipt.result !== "passed")
    throw new Error(
      `No passing ${check} receipt; run npm run verify:push on a clean checkout first`,
    );
  const { tests, environment } = receipt;
  if (environment?.node === undefined || tests === undefined)
    throw new Error(`The ${check} receipt lacks its environment or its tests`);
  const collection = testSuite(check) !== undefined;
  if (collection && (tests === null || tests.ids.length === 0 || tests.modules.length === 0))
    throw new Error(`The ${check} receipt records no passed test`);
  return { tests, environment: { node: environment.node, tools: environment.tools ?? {} } };
}

/** Tool identity that a receipt must carry
 * @param receipt - Passing receipt of the collection that probes the tool
 * @param tool - Tool name in the receipt's environment
 * @returns The probe output
 * @throws {@link Error} A receipt that did not probe the tool
 */
function identity(receipt: SummarizedReceipt, tool: string): string {
  const text = receipt.environment.tools[tool];
  if (text === undefined) throw new Error(`The receipt has no ${tool} identity`);
  return text;
}

/** .NET SDK release of a `dotnet --info` output
 * @param info - Output of `dotnet --info`
 * @returns SDK version such as `10.0.201`
 * @throws {@link Error} An output without an SDK version
 */
function dotnetSdk(info: string): string {
  const version = /\.NET SDK:\s+Version:\s+(\S+)/.exec(info)?.[1];
  if (version === undefined) throw new Error("The dotnet identity has no SDK version");
  return version;
}

/** Release of a Rust tool
 * @param receipt - Passing receipt of the rust collection
 * @param tool - `rustc` or `cargo`
 * @returns Release such as `1.94.0`
 * @throws {@link Error} An identity of another shape
 */
function rust(receipt: SummarizedReceipt, tool: "rustc" | "cargo"): string {
  const release = rustRelease(tool, identity(receipt, tool));
  if (release === undefined) throw new Error(`The ${tool} identity has no release`);
  return release;
}

/** One count of the form `3 tests in 1 module`
 * @param tests - Passed identities and completed modules of a collection
 * @returns Count line body
 */
function count(tests: NonNullable<SummarizedReceipt["tests"]>): string {
  const modules = tests.modules.length;
  return `${tests.ids.length} tests in ${modules} ${modules === 1 ? "module" : "modules"}`;
}

/**
 * Text of an annotated release tag from the receipts that `npm run verify:push` stores
 * @param commit - Commit that the receipts were recorded on
 * @param receipts - Stored receipt JSON of every check by check name
 * @returns The commit, the toolchain and the number of passed tests per collection
 * @throws {@link Error} A check without a passing receipt, or a receipt that lacks a toolchain identity
 */
export function releaseSummary(
  commit: string,
  receipts: Readonly<Record<string, unknown>>,
): string {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Not a full commit id: ${commit}`);
  const checks = [...commitChecks, ...nativeChecks];
  const passed = new Map(checks.map((check) => [check, passingReceipt(check, receipts[check])]));
  const get = (check: Check): SummarizedReceipt => passed.get(check)!;
  const [gtk, webkit, soup] = identity(get("tauri"), "webkit").trim().split("\n");
  return (
    [
      "verify:push summary",
      `commit: ${commit}`,
      `node: ${get("build").environment.node}`,
      `dotnet SDK: ${dotnetSdk(identity(get("csharp"), "dotnet"))}`,
      `rustc: ${rust(get("rust"), "rustc")}`,
      `cargo: ${rust(get("rust"), "cargo")}`,
      `gtk+-3.0: ${gtk}`,
      `webkit2gtk-4.1: ${webkit}`,
      `libsoup-3.0: ${soup}`,
      ...checks.map((check) => {
        const { tests } = get(check);
        return `${check}: ${tests === null ? "passed" : count(tests)}`;
      }),
    ].join("\n") + "\n"
  );
}
