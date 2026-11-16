import { expect, test, vi } from "vite-plus/test";
import { reusableReceipt } from "./evidence.ts";
import { checkCommand, reuseBlocker } from "./plan.ts";
import { requireExactRust, rustRelease, verificationEnvironment } from "./environment.ts";
import { suiteOf } from "./suites.ts";

/** Previously observed successful build receipt */
const passed = {
  version: 1,
  check: "build",
  key: "source-dependencies-env-command",
  result: "passed",
  output: "dist-bytes",
  seconds: 2,
};

test("unchanged check evidence survives an unrelated source-tree revision", () => {
  expect(reusableReceipt(passed, "build", "source-dependencies-env-command", "dist-bytes")).toBe(
    true,
  );
});

test.each(["source-edited", "dependency-edited", "environment-edited", "command-edited"])(
  "%s invalidates earlier pass evidence",
  (key) => {
    expect(reusableReceipt(passed, "build", key, "dist-bytes")).toBe(false);
  },
);

test.each(["failed", "interrupted", "pending", "skipped"])("%s is not pass evidence", (result) => {
  expect(reusableReceipt({ ...passed, result }, "build", passed.key, "dist-bytes")).toBe(false);
});

test("missing or edited generated output invalidates build evidence", () => {
  expect(reusableReceipt(passed, "build", passed.key, "missing")).toBe(false);
  expect(reusableReceipt(passed, "build", passed.key, "edited-output")).toBe(false);
});

test("a long cumulative history does not invalidate current successful evidence", () => {
  expect(
    reusableReceipt(
      { ...passed, previousAttemptSeconds: 50_000 },
      "build",
      passed.key,
      "dist-bytes",
    ),
  ).toBe(true);
});

test("a Small collection runs in a network-isolated runner rather than a recursive whole-suite entry", () => {
  const command = checkCommand("small", {});
  expect(command.slice(0, 5)).toEqual(["unshare", "--user", "--map-current-user", "--net", "--"]);
  expect(command.slice(-2)).toEqual(["test", "run"]);
  expect(command).not.toContain("verify");
});

test("live WebView state is never reused as a source fingerprint", () => {
  expect(reuseBlocker("tauri", {})).toContain("fresh acceptance scenario");
});

/** Existence test of a machine that holds exactly these configuration files */
const holding =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);
/** User and C# dependency project whose directories can hold tool configuration */
const machine = {
  HOME: "/home/user",
  TypeModelingProjectPath: "/work/typemodeling/src/TypeModeling/TypeModeling.csproj",
};
/** NuGet configuration files outside the checkout that the restore ignores because it reads only the repository's offline configuration */
const nugetFiles = [
  "/home/user/.nuget/NuGet/NuGet.Config",
  "/home/user/.config/NuGet/NuGet.Config",
  "/work/NuGet.Config",
];
/** Cargo configuration files that a native build reads outside the checkout */
const cargoFiles = ["/home/user/.cargo/config.toml", "/home/user/.cargo/config"];

test.each(nugetFiles)(
  "the NuGet configuration %s does not stop reuse of the csharp collection",
  (file) => {
    expect(reuseBlocker("csharp", machine, holding(file))).toBeUndefined();
  },
);

test("an MSBuild file above the C# dependency stops reuse of the csharp collection", () => {
  expect(reuseBlocker("csharp", machine, holding("/work/Directory.Build.props"))).toContain(
    "/work/Directory.Build.props",
  );
});

test.each(cargoFiles)("the Cargo configuration %s stops reuse of the rust collection", (file) => {
  expect(reuseBlocker("rust", machine, holding(file))).toContain(file);
});

test("a Cargo home elsewhere is where Cargo configuration stops reuse of the rust collection", () => {
  const env = { ...machine, CARGO_HOME: "/cargo" };
  expect(reuseBlocker("rust", env, holding("/cargo/config.toml"))).toContain("/cargo/config.toml");
});

test("NuGet configuration does not stop reuse of the rust collection", () => {
  expect(reuseBlocker("rust", machine, holding(...nugetFiles))).toBeUndefined();
});

test("Cargo configuration does not stop reuse of the csharp collection", () => {
  expect(reuseBlocker("csharp", machine, holding(...cargoFiles))).toBeUndefined();
});

/** First lines of `-vV` for a compiler and package manager of one release */
const identity = (release: string) => ({
  rustc: `rustc ${release} (4a4ef493e 2026-03-02)\nbinary: rustc\nrelease: ${release}\n`,
  cargo: `cargo ${release} (3861f60f6 2026-02-21)\nrelease: ${release}\n`,
});

test("the exact Rust preflight accepts the required release for the compiler and the package manager", () => {
  expect(() => requireExactRust(identity("1.94.0"), "1.94.0")).not.toThrow();
  expect(rustRelease("cargo", identity("1.94.0").cargo)).toBe("1.94.0");
});

test.each(["1.93.1", "1.94.1", "1.95.0", "2.0.0"])(
  "the exact Rust preflight rejects release %s, newer ones included",
  (release) => {
    expect(() => requireExactRust(identity(release), "1.94.0")).toThrow(
      `requires rustc 1.94.0; found ${release}`,
    );
  },
);

test("the exact Rust preflight rejects a package manager that differs from a matching compiler", () => {
  const mixed = { rustc: identity("1.94.0").rustc, cargo: identity("1.95.0").cargo };
  expect(() => requireExactRust(mixed, "1.94.0")).toThrow("requires cargo 1.94.0; found 1.95.0");
});

test.each(["", "rustc nightly", "rustc 1.94.0-beta.1 (abc 2026-03-02)"])(
  "the exact Rust preflight rejects the unrecognized identity %j",
  (output) => {
    expect(() =>
      requireExactRust({ rustc: output, cargo: identity("1.94.0").cargo }, "1.94.0"),
    ).toThrow("found an unrecognized identity");
  },
);

test.each([
  ["src/targets/rust/render-rust.test.ts", "small"],
  ["scripts/verification/evidence.test.ts", "small"],
  ["src/profile/tests/medium/union-types.test.ts", "profile"],
  ["src/profile/tests/medium/http-route.test.ts", "profile"],
  ["src/profile/tests/medium/safe-patterns.test.ts", "profile"],
  ["tests/arch/medium/module-boundaries.test.ts", "arch"],
  ["tests/integration/medium/rust-native-build.test.ts", "rust"],
  ["tests/integration/medium/rust-source-data.test.ts", "rust"],
  ["tests/integration/medium/csharp-source-data.test.ts", "csharp"],
  ["tests/integration/medium/safe-pattern-publication.test.ts", "local"],
  ["tests/integration/medium/tauri-webview.test.ts", "tauri"],
])("%s belongs to the %s collection", (path, suite) => {
  expect(suiteOf(path)).toBe(suite);
});

test.each([
  "tests/integration/large/unregistered.test.ts",
  "src/targets/tests/medium/unregistered.test.ts",
  "tests/integration/medium/unregistered.test.ts",
  "tests/integration/medium/nested/rust-codec.test.ts",
])("%s fails classification rather than disappearing from acceptance", (path) => {
  expect(() => suiteOf(path)).toThrow("Unclassified test module");
});

test("credential values and implicit compiler flags are not forwarded to public checks", () => {
  vi.stubEnv("GITHUB_TOKEN", "credential");
  vi.stubEnv("NUGET_AUTH_TOKEN", "credential");
  vi.stubEnv("RUSTFLAGS", "--cfg unchecked");
  vi.stubEnv("RUST_CONTRACT_FETCH", "1");
  const env = verificationEnvironment();
  vi.unstubAllEnvs();
  expect([env.GITHUB_TOKEN, env.NUGET_AUTH_TOKEN, env.RUSTFLAGS, env.RUST_CONTRACT_FETCH]).toEqual([
    undefined,
    undefined,
    undefined,
    "0",
  ]);
});
