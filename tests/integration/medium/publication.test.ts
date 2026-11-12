import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { publishOutput } from "../../../src/publication/publish-output.js";
import { first, second, usePublicationSandbox } from "./publication-support.js";

const sandbox = usePublicationSandbox();

/** Permission bits of a directory
 * @param path - Existing directory
 * @returns Permission bits without file type bits
 */
async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

test("a new generation replaces the whole previous tree and leaves no staging directory", async () => {
  const { output, parent } = sandbox;
  expect((await publishOutput(output, first, false)).unwrap().changed).toBe(true);
  expect((await publishOutput(output, second, false)).unwrap().changed).toBe(true);
  expect(await readFile(join(output, "typescript/contract.ts"), "utf8")).toBe("second\n");
  expect((await readdir(output)).sort()).toEqual([".contract-generator.json", "typescript"]);
  expect(await readdir(parent)).toEqual(["out"]);
});

test("an identical generation changes nothing", async () => {
  await publishOutput(sandbox.output, first, false);
  expect((await publishOutput(sandbox.output, first, false)).unwrap().changed).toBe(false);
});

test("a nonempty directory without the ownership marker is refused and kept", async () => {
  const { output } = sandbox;
  await mkdir(output);
  await writeFile(join(output, "notes.txt"), "mine\n");
  const result = await publishOutput(output, first, false);
  expect(result.unwrapErr().code).toBe("output-not-owned");
  expect(await readdir(output)).toEqual(["notes.txt"]);
});

test("a file added beside generated artifacts is refused and kept", async () => {
  const { output } = sandbox;
  await publishOutput(output, first, false);
  await writeFile(join(output, "typescript/extra.ts"), "mine\n");
  expect((await publishOutput(output, second, false)).unwrapErr().code).toBe("output-not-owned");
  expect(await readFile(join(output, "typescript/extra.ts"), "utf8")).toBe("mine\n");
  expect(await readFile(join(output, "typescript/contract.ts"), "utf8")).toBe("first\n");
});

test("a hand-edited generated artifact is refused and kept", async () => {
  const { output } = sandbox;
  await publishOutput(output, first, false);
  await writeFile(join(output, "typescript/contract.ts"), "edited\n");
  expect((await publishOutput(output, second, false)).unwrapErr().code).toBe("output-modified");
  expect(await readFile(join(output, "typescript/contract.ts"), "utf8")).toBe("edited\n");
});

test("check mode reports drift without writing", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  expect((await publishOutput(output, second, true)).unwrapErr().code).toBe("output-drift");
  expect(await readFile(join(output, "typescript/contract.ts"), "utf8")).toBe("first\n");
  expect((await publishOutput(output, first, true)).unwrap().changed).toBe(false);
  expect((await publishOutput(join(parent, "absent"), first, true)).unwrapErr().code).toBe(
    "output-drift",
  );
  expect(await readdir(parent)).toEqual(["out"]);
});

test.each(["../escape.ts", "/absolute.ts", "a//b.ts", ".contract-generator.json", "a\\b.ts"])(
  "artifact path %s is rejected before any write",
  async (path) => {
    const result = await publishOutput(sandbox.output, [{ path, content: "" }], false);
    expect(result.unwrapErr().code).toBe("invalid-artifact");
    expect(await readdir(sandbox.parent)).toEqual([]);
  },
);

test("a new output directory gets the mode a plain mkdir would give it", async () => {
  const { output, parent } = sandbox;
  const control = join(parent, "control");
  await mkdir(control);
  await publishOutput(output, first, false);
  expect(await modeOf(output)).toBe(await modeOf(control));
});

test("a replacement keeps the permission bits of the output directory", async () => {
  const { output } = sandbox;
  await publishOutput(output, first, false);
  await chmod(output, 0o750);
  await publishOutput(output, second, false);
  expect(await modeOf(output)).toBe(0o750);
});

test("a filesystem failure is output-io and keeps the previous output without leftovers", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  const tooLong = [{ path: "a".repeat(300) + ".ts", content: "x\n" }];
  const failure = (await publishOutput(output, tooLong, false)).unwrapErr();
  expect(failure.code).toBe("output-io");
  expect(failure.recoveryPaths).toEqual([]);
  expect(await readFile(join(output, "typescript/contract.ts"), "utf8")).toBe("first\n");
  expect(await readdir(parent)).toEqual(["out"]);
});

test("a filesystem failure without a previous output leaves nothing behind", async () => {
  const tooLong = [{ path: "a".repeat(300) + ".ts", content: "x\n" }];
  const failure = (await publishOutput(sandbox.output, tooLong, false)).unwrapErr();
  expect(failure.code).toBe("output-io");
  expect(await readdir(sandbox.parent)).toEqual([]);
});

test("a defect while reading the destination propagates instead of becoming output-io", async () => {
  const nulInPath = join(sandbox.parent, "bad\0directory");
  await expect(publishOutput(nulInPath, first, false)).rejects.toMatchObject({
    code: "ERR_INVALID_ARG_VALUE",
  });
});

test("a defect while replacing propagates, keeps the previous output and removes the workspace", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  const nulInArtifact = [{ path: "a\0b.ts", content: "x\n" }];
  await expect(publishOutput(output, nulInArtifact, false)).rejects.toMatchObject({
    code: "ERR_INVALID_ARG_VALUE",
  });
  expect(await readFile(join(output, "typescript/contract.ts"), "utf8")).toBe("first\n");
  expect(await readdir(parent)).toEqual(["out"]);
});
