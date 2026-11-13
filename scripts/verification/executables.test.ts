import { expect, test } from "vite-plus/test";
import { stableEnvironment } from "./environment.ts";
import { executableIdentity, executableNames, type ExecutableFiles } from "./executables.ts";
import { digestValue } from "./inputs.ts";

/** Files of a machine as path to real path; every listed path is an executable */
const machine = (real: Record<string, string>): ExecutableFiles => ({
  isExecutable: (path) => path in real,
  realPath: (path) => real[path] ?? path,
});

/** Tool files that the csharp collection needs from the search path */
const tools = {
  "/shell/bin/bwrap": "/store/bubblewrap/bin/bwrap",
  "/shell/bin/dotnet": "/store/dotnet-10/dotnet",
};
const installed = machine(tools);
const caller = {
  HOME: "/home/user",
  PATH: "/shell/bin:/caller/bin",
  LD_LIBRARY_PATH: "/store/lib",
  USER: "user",
  DISPLAY: ":0",
};

/** What enters the evidence key from the environment and the resolved executables */
const identityOf = (env: NodeJS.ProcessEnv, files: ExecutableFiles) =>
  digestValue({
    env: stableEnvironment(env),
    executables: executableIdentity("csharp", env, files),
  });

test("an unrelated directory in the search path does not change the identity", () => {
  const widened = { ...caller, PATH: `/unrelated/bin:${caller.PATH}:/other/bin` };
  expect(identityOf(widened, installed)).toBe(identityOf(caller, installed));
});

test.each(["USER", "LOGNAME", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "TMPDIR"])(
  "the caller's session variable %s does not change the identity",
  (name) => {
    expect(identityOf({ ...caller, [name]: "/another/session" }, installed)).toBe(
      identityOf(caller, installed),
    );
  },
);

test("a variable that selects a library still changes the identity", () => {
  expect(identityOf({ ...caller, LD_LIBRARY_PATH: "/store/other-lib" }, installed)).not.toBe(
    identityOf(caller, installed),
  );
});

test("a name that resolves to another file changes the identity", () => {
  const replaced = machine({ ...tools, "/shell/bin/dotnet": "/store/dotnet-11/dotnet" });
  expect(identityOf(caller, replaced)).not.toBe(identityOf(caller, installed));
});

test("another search order that finds another file for a name changes the identity", () => {
  const shadowed = machine({ ...tools, "/caller/bin/dotnet": "/store/dotnet-9/dotnet" });
  expect(identityOf({ ...caller, PATH: "/caller/bin:/shell/bin" }, shadowed)).not.toBe(
    identityOf(caller, shadowed),
  );
});

test("two links to one real file are one tool", () => {
  const linked = machine({ ...tools, "/caller/bin/dotnet": "/store/dotnet-10/dotnet" });
  expect(identityOf({ ...caller, PATH: "/caller/bin:/shell/bin" }, linked)).toBe(
    identityOf(caller, linked),
  );
});

test("a required executable that the search path does not hold fails the identity", () => {
  expect(() => executableIdentity("csharp", caller, machine({}))).toThrow(
    "Required executable bwrap is not on the search path",
  );
});

test.each([
  ["build", []],
  ["small", ["unshare"]],
  ["typescript", ["bwrap"]],
  ["csharp", ["bwrap", "dotnet"]],
  ["rust", ["ar", "bwrap", "cargo", "cargo-clippy", "cc", "g++", "gcc", "pkg-config", "rustc"]],
  [
    "tauri",
    [
      "ar",
      "bwrap",
      "cargo",
      "cargo-clippy",
      "cc",
      "dbus-run-session",
      "g++",
      "gcc",
      "pkg-config",
      "rustc",
      "xvfb-run",
    ],
  ],
] as const)("the %s check starts these executables by name", (check, names) => {
  const env = { CC: "gcc", CXX: "g++", AR: "ar" };
  expect(executableNames(check, env)).toEqual(names);
});

test("the Rust compiler is the one that RUSTC names", () => {
  expect(executableNames("rust", { RUSTC: "/store/rustc/bin/rustc" })).toContain(
    "/store/rustc/bin/rustc",
  );
});
