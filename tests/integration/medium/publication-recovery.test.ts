import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { publishOutput } from "../../../src/publication/publish-output.js";
import {
  first,
  interruptReplacement,
  second,
  usePublicationSandbox,
} from "./publication-support.js";

const sandbox = usePublicationSandbox();

test("the previous output displaced by an interrupted replacement is restored and then replaced", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  await interruptReplacement(output);
  expect(await readdir(parent)).not.toContain("out");
  const receipt = (await publishOutput(output, second, false)).unwrap();
  expect(receipt).toEqual({ changed: true, retainedPaths: [] });
  expect(await readFile(join(output, "typescript/contract.ts"), "utf8")).toBe("second\n");
  expect(await readdir(parent)).toEqual(["out"]);
});

test("an interrupted replacement followed by an identical generation restores and changes nothing", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  await interruptReplacement(output);
  expect((await publishOutput(output, first, false)).unwrap().changed).toBe(false);
  expect(await readFile(join(output, "typescript/contract.ts"), "utf8")).toBe("first\n");
  expect(await readdir(parent)).toEqual(["out"]);
});

test("check mode never restores an interrupted replacement", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  const workspace = await interruptReplacement(output);
  expect((await publishOutput(output, first, true)).unwrapErr().code).toBe("output-drift");
  expect(await readdir(parent)).toEqual([basename(workspace)]);
});

test("a displaced previous output that was modified is refused and kept where it is", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  const workspace = await interruptReplacement(output);
  await writeFile(join(workspace, "previous/typescript/contract.ts"), "edited\n");
  const failure = (await publishOutput(output, second, false)).unwrapErr();
  expect(failure.code).toBe("output-interrupted");
  expect(failure.recoveryPaths).toEqual([workspace]);
  const kept = await readFile(join(workspace, "previous/typescript/contract.ts"), "utf8");
  expect(kept).toBe("edited\n");
  expect(await readdir(parent)).toEqual([basename(workspace)]);
});

test("several interrupted replacements are refused instead of choosing one", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  const older = await interruptReplacement(output, "Older1");
  const scratch = join(parent, "scratch");
  await publishOutput(scratch, second, false);
  const newer = join(parent, ".out.contract-generator-publish-Newer2");
  await mkdir(newer);
  await rename(scratch, join(newer, "previous"));
  const failure = (await publishOutput(output, second, false)).unwrapErr();
  expect(failure.code).toBe("output-interrupted");
  expect(failure.recoveryPaths).toEqual([newer, older]);
  expect(await readdir(parent)).not.toContain("out");
});

test("workspaces of another output and workspaces without a displaced tree are left alone", async () => {
  const { output, parent } = sandbox;
  const untouched = [
    ".other.contract-generator-publish-Abc123",
    ".out.contract-generator-publish-Abc123.contract-generator-publish-Abc123",
  ];
  for (const name of untouched) await mkdir(join(parent, name, "previous"), { recursive: true });
  const partial = ".out.contract-generator-publish-Part12";
  await mkdir(join(parent, partial, "staged"), { recursive: true });
  expect((await publishOutput(output, first, false)).unwrap().changed).toBe(true);
  expect((await readdir(parent)).sort()).toEqual([...untouched, partial, "out"].sort());
});
