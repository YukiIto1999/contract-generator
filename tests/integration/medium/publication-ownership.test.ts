import { lstat, mkdir, readFile, readdir, rmdir, stat, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { publishOutput } from "../../../src/publication/publish-output.js";
import { expectPublishedTree, usePublicationProcesses } from "./publication-process-support.js";
import { first, second, usePublicationSandbox } from "./publication-support.js";

/** Isolated destination and ownership residue for each scenario */
const sandbox = usePublicationSandbox();
/** Independently controlled publishers with deterministic filesystem barriers */
const start = usePublicationProcesses();

test("a killed publisher leaves actionable ownership residue without competitor recovery", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  const abandoned = start({ output, files: second, check: false, barrier: "after-displace" });
  const workspace = await abandoned.paused;
  expect(workspace).toBeDefined();
  abandoned.child.kill("SIGKILL");
  await abandoned.closed;
  const lock = join(parent, ".out.contract-generator.lock");
  const before = await lstat(lock);
  const entries = (await readdir(parent)).sort();
  for (const check of [false, true]) {
    const failure = (await publishOutput(output, first, check)).unwrapErr();
    expect(failure.code).toBe("output-conflict");
    expect(failure.recoveryPaths).toEqual([lock]);
    expect(failure.message).toContain("independently verifying that no publisher remains");
    expect(failure.message).toContain("preserve any previous tree");
    expect((await readdir(parent)).sort()).toEqual(entries);
    expect((await lstat(lock)).ino).toBe(before.ino);
  }
  expect(await readFile(join(workspace ?? "", "previous/typescript/contract.ts"), "utf8")).toBe(
    "first\n",
  );
  expect(entries).not.toContain("out");
  await rmdir(lock);
  const recovered = (await publishOutput(output, first, false)).unwrap();
  expect(recovered).toEqual({ changed: false, retainedPaths: [workspace] });
  await expectPublishedTree(output, first);
  expect(await readFile(join(workspace ?? "", "staged/typescript/contract.ts"), "utf8")).toBe(
    "second\n",
  );
  expect((await readdir(parent)).sort()).toEqual([basename(workspace ?? ""), "out"].sort());
});

test.each(["before-stage", "before-displace"] as const)(
  "a filesystem refusal at %s releases ownership and preserves the successful output",
  async (barrier) => {
    const { output, parent } = sandbox;
    await publishOutput(output, first, false);
    const failed = start({ output, files: second, check: false, barrier });
    await failed.paused;
    failed.child.send("fail");
    expect(await failed.completed).toMatchObject({
      kind: "refused",
      failure: { code: "output-io", recoveryPaths: [] },
    });
    await expectPublishedTree(output, first);
    expect(await readdir(parent)).toEqual(["out"]);
    expect(await start({ output, files: second, check: false }).completed).toMatchObject({
      kind: "published",
    });
    await expectPublishedTree(output, second);
    expect(await readdir(parent)).toEqual(["out"]);
  },
);

test("failure before staging a fresh output releases ownership without creating a destination", async () => {
  const { output, parent } = sandbox;
  const failed = start({ output, files: first, check: false, barrier: "before-stage" });
  await failed.paused;
  failed.child.send("fail");
  expect(await failed.completed).toMatchObject({ kind: "refused", failure: { code: "output-io" } });
  expect(await readdir(parent)).toEqual([]);
  expect((await publishOutput(output, first, false)).unwrap().changed).toBe(true);
  await expectPublishedTree(output, first);
});

test.each(["file", "symlink", "directory"] as const)(
  "an unknown %s at the ownership path is refused without deletion",
  async (kind) => {
    const { output, parent } = sandbox;
    const lock = join(parent, ".out.contract-generator.lock");
    const notes = join(parent, "notes.txt");
    await writeFile(notes, "mine\n");
    if (kind === "symlink") await symlink(notes, lock);
    else if (kind === "file") await writeFile(lock, "unknown owner\n");
    else await mkdir(lock);
    const before = (await readdir(parent)).sort();
    const identity = await lstat(lock);
    for (const check of [false, true]) {
      expect((await publishOutput(output, first, check)).unwrapErr().code).toBe("output-conflict");
      expect((await readdir(parent)).sort()).toEqual(before);
      expect((await lstat(lock)).ino).toBe(identity.ino);
      expect(await readFile(notes, "utf8")).toBe("mine\n");
    }
    if (kind === "file") expect(await readFile(lock, "utf8")).toBe("unknown owner\n");
  },
);

test("check mode on a missing nested destination creates neither parent nor ownership", async () => {
  const output = join(sandbox.parent, "missing", "nested", "out");
  expect((await publishOutput(output, first, true)).unwrapErr().code).toBe("output-drift");
  expect(await readdir(sandbox.parent)).toEqual([]);
});

test("an output symbolic link stays refused even though its parent is canonicalized", async () => {
  const { output, parent } = sandbox;
  const actual = join(parent, "actual");
  await publishOutput(actual, first, false);
  await symlink(actual, output, "dir");
  expect((await publishOutput(output, second, false)).unwrapErr().code).toBe("output-not-owned");
  expect((await publishOutput(output, first, true)).unwrapErr().code).toBe("output-not-owned");
  expect((await lstat(output)).isSymbolicLink()).toBe(true);
  await expectPublishedTree(actual, first);
  expect((await readdir(parent)).sort()).toEqual(["actual", "out"]);
});

test.each([
  [false, "before-stage"],
  [true, "before-stage"],
  [false, "before-reserve"],
  [true, "before-reserve"],
] as const)(
  "an intervening destination stays untouched when empty %s at %s",
  async (empty, barrier) => {
    const { output, parent } = sandbox;
    const publisher = start({ output, files: first, check: false, barrier });
    await publisher.paused;
    await mkdir(output);
    const before = await stat(output);
    if (!empty) await writeFile(join(output, "notes.txt"), "mine\n");
    publisher.child.send("continue");
    expect(await publisher.completed).toMatchObject({
      kind: "refused",
      failure: { code: "output-not-owned" },
    });
    expect((await stat(output)).ino).toBe(before.ino);
    expect(await readdir(output)).toEqual(empty ? [] : ["notes.txt"]);
    if (!empty) expect(await readFile(join(output, "notes.txt"), "utf8")).toBe("mine\n");
    expect(await readdir(parent)).toEqual(["out"]);
  },
);

test.each(["empty", "published"] as const)(
  "a user file added to an initially %s destination during staging stays untouched",
  async (initial) => {
    const { output, parent } = sandbox;
    if (initial === "empty") await mkdir(output);
    else await publishOutput(output, first, false);
    const publisher = start({ output, files: second, check: false, barrier: "before-stage" });
    await publisher.paused;
    await writeFile(join(output, "notes.txt"), "mine\n");
    publisher.child.send("continue");
    expect(await publisher.completed).toMatchObject({
      kind: "refused",
      failure: { code: "output-not-owned" },
    });
    expect(await readFile(join(output, "notes.txt"), "utf8")).toBe("mine\n");
    if (initial === "published")
      expect(await readFile(join(output, "typescript/contract.ts"), "utf8")).toBe("first\n");
    expect(await readdir(parent)).toEqual(["out"]);
  },
);

test("ownership cleanup never recursively deletes unexpected files", async () => {
  const { output, parent } = sandbox;
  const publisher = start({ output, files: first, check: false, barrier: "before-stage" });
  await publisher.paused;
  const lock = join(parent, ".out.contract-generator.lock");
  await writeFile(join(lock, "notes.txt"), "mine\n");
  publisher.child.send("continue");
  expect(await publisher.completed).toEqual({
    kind: "published",
    receipt: { changed: true, retainedPaths: [lock] },
  });
  await expectPublishedTree(output, first);
  expect(await readFile(join(lock, "notes.txt"), "utf8")).toBe("mine\n");
  expect((await publishOutput(output, first, false)).unwrapErr().code).toBe("output-conflict");
});

test.each([false, true])(
  "failed installation removes only its unchanged empty reservation with user file %s",
  async (userFile) => {
    const { output, parent } = sandbox;
    const publisher = start({ output, files: first, check: false, barrier: "before-install" });
    await publisher.paused;
    if (userFile) await writeFile(join(output, "notes.txt"), "mine\n");
    publisher.child.send("fail");
    expect(await publisher.completed).toMatchObject({
      kind: "refused",
      failure: { code: "output-io", recoveryPaths: userFile ? [output] : [] },
    });
    expect(await readdir(parent)).toEqual(userFile ? ["out"] : []);
    if (userFile) expect(await readFile(join(output, "notes.txt"), "utf8")).toBe("mine\n");
    else {
      expect((await publishOutput(output, first, false)).unwrap().changed).toBe(true);
      await expectPublishedTree(output, first);
    }
  },
);
