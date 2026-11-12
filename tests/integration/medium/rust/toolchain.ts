import { spawnSync } from "node:child_process";
import { rustMinimumVersion } from "../../../../src/targets/rust/dependencies.js";

/** Whether the acceptance entry demands the supported-minimum proof instead of any compatible compiler */
const exactMinimum = process.env.RUST_CONTRACT_EXACT_MINIMUM === "1";

/** Required native toolchain identity relative to the generated compiler floor
 * @param command - Compiler or package manager executable
 * @returns Complete version identity
 * @throws {@link Error} Missing executable, a version below the floor, or any version other than the floor when the exact minimum is demanded
 */
function toolchainVersion(command: "cargo" | "rustc"): string {
  const executable = command === "rustc" ? (process.env.RUSTC ?? command) : command;
  const probe = spawnSync(executable, ["--version"], { encoding: "utf8" });
  const found = new RegExp(`^${command} (\\d+)\\.(\\d+)\\.(\\d+) `).exec(probe.stdout ?? "");
  const minimum = rustMinimumVersion.split(".").map(Number);
  const difference = (found?.slice(1).map(Number) ?? [])
    .map((part, index) => part - (minimum[index] ?? 0))
    .find((delta) => delta !== 0);
  const supported =
    found !== null && (difference === undefined || (!exactMinimum && difference > 0));
  if (probe.status !== 0 || !supported)
    throw new Error(
      `${command} ${exactMinimum ? "" : ">="}${rustMinimumVersion} is required for Rust acceptance; enter \`devenv shell\`. ${probe.error?.message ?? probe.stderr ?? ""}`,
    );
  return probe.stdout.trim();
}

/** Required compiler and package manager for native Rust acceptance
 * @returns Validated package manager identity
 * @throws {@link Error} Missing tool or a release outside the requested support policy
 */
export function requireRustToolchain(): string {
  const cargoVersion = toolchainVersion("cargo");
  toolchainVersion("rustc");
  return cargoVersion;
}
