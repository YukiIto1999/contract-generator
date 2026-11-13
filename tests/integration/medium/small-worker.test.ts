import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import {
  entryResolution,
  memoryWorkerArguments,
  virtualEntry,
} from "../../../scripts/verification/memory-loader.ts";

/** Test-owned package whose ESM entry imports CommonJS that requires JSON */
let root = "";
/** Serialized snapshot built by the parent-side builder before the worker starts */
let snapshot = "";

/** Source-seeded CommonJS package graph with a transitive native require
 * @param directory - Test-owned package root
 * @returns Package directories for entry loading and post-snapshot mutation
 */
async function transitivePackages(directory: string): Promise<{ wrapper: string; nested: string }> {
  const wrapper = join(directory, "node_modules/wrapper");
  const nested = join(directory, "node_modules/nested");
  await mkdir(wrapper, { recursive: true });
  await mkdir(nested, { recursive: true });
  await writeFile(join(wrapper, "package.json"), '{"main":"index.cjs"}');
  await writeFile(
    join(wrapper, "index.cjs"),
    '"use strict"; if ((function () { return this; })() !== undefined) throw new Error("strict directive lost"); module.exports = require("nested");',
  );
  await writeFile(join(nested, "package.json"), '{"main":"index.cjs"}');
  await writeFile(join(nested, "index.cjs"), 'module.exports = "transitive-package";');
  await writeFile(join(directory, "test-source.ts"), 'import value from "wrapper"; void value;');
  return { wrapper, nested };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "contract-small-worker-"));
  await writeFile(join(root, "package.json"), '{ "type": "module" }\n');
  await writeFile(join(root, "data.json"), '{ "label": "from-snapshot" }\n');
  await writeFile(join(root, "dependency.cjs"), 'module.exports = require("./data.json").label;\n');
  const { wrapper, nested } = await transitivePackages(root);
  await writeFile(
    join(root, "entry.js"),
    `import { readFileSync } from "node:fs";
import label from "./dependency.cjs";
// Static import would seed the entry graph instead of exercising the test-source package closure
const wrapperURL = ${JSON.stringify(pathToFileURL(join(wrapper, "index.cjs")).href)};
const transitive = (await import(wrapperURL)).default;
const code = (operation) => { try { operation(); return "allowed"; } catch (error) { return error.code; } };
let absent;
try { await import("./absent.js"); absent = "loaded"; } catch (error) { absent = error.code; }
process.send({
  label,
  transitive,
  entryRead: code(() => readFileSync(new URL("./entry.js", import.meta.url))),
  absent,
}, () => process.exit(0));
`,
  );
  const built = spawnSync(
    process.execPath,
    [
      "--experimental-import-meta-resolve",
      "scripts/verification/runner-snapshot.ts",
      join(root, "entry.js"),
      "--sources",
      join(root, "test-source.ts"),
    ],
    { encoding: "utf8", maxBuffer: 1 << 24 },
  );
  expect({ status: built.status, stderr: built.status === 0 ? "" : built.stderr }).toEqual({
    status: 0,
    stderr: "",
  });
  snapshot = built.stdout;
  await writeFile(join(root, "dependency.cjs"), 'module.exports = "edited after the snapshot";\n');
  await writeFile(join(nested, "index.cjs"), 'module.exports = "edited after the snapshot";');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Snapshot execution failing immediately when the worker exits before reporting
 * @param serialized - Immutable worker snapshot
 * @returns Worker observation after successful process exit
 * @throws {@link Error} Worker startup failure or exit before its observation
 */
async function observeWorker(serialized: string): Promise<unknown> {
  const child = fork(virtualEntry, [], {
    execArgv: memoryWorkerArguments(),
    stdio: ["pipe", "inherit", "inherit", "ipc"],
  });
  const exited = once(child, "exit");
  const observation = once(child, "message");
  child.stdin?.end(serialized);
  const observed = await Promise.race([
    observation.then(([message]) => message),
    exited.then(([code, signal]) => {
      throw new Error(`Small worker exited before observation: status ${code}; signal ${signal}`);
    }),
  ]);
  const [code, signal] = await exited;
  if (code !== 0 || signal !== null)
    throw new Error(`Small worker failed after observation: status ${code}; signal ${signal}`);
  return observed;
}

test("a worker without read permission runs the snapshot fixed before it started", async () => {
  const observed = await observeWorker(snapshot);
  expect(observed).toEqual({
    label: "from-snapshot",
    transitive: "transitive-package",
    entryRead: "ERR_ACCESS_DENIED",
    absent: "ERR_MODULE_NOT_FOUND",
  });
});

test("an early worker exit rejects the observation instead of waiting for a test timeout", async () => {
  const url = pathToFileURL(join(root, "early-exit.js")).href;
  const serialized = JSON.stringify({
    modules: { [url]: { format: "module", source: "process.exit(7);" } },
    resolutions: entryResolution(url),
  });
  await expect(observeWorker(serialized)).rejects.toThrow("exited before observation: status 7");
});

test("the snapshot builder rejects a native addon instead of granting a read", async () => {
  await writeFile(join(root, "addon-entry.js"), 'import "./binding.node";\n');
  await writeFile(join(root, "binding.node"), "");
  const built = spawnSync(
    process.execPath,
    [
      "--experimental-import-meta-resolve",
      "scripts/verification/runner-snapshot.ts",
      join(root, "addon-entry.js"),
    ],
    { encoding: "utf8" },
  );
  expect(built.status).not.toBe(0);
  expect(built.stderr).toContain("Unsupported Small worker module");
});
