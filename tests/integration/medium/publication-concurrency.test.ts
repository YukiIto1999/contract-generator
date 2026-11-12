import { mkdir, readFile, readdir, symlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { publishOutput } from "../../../src/publication/publish-output.js";
import { expectPublishedTree, usePublicationProcesses } from "./publication-process-support.js";
import { first, second, usePublicationSandbox } from "./publication-support.js";

/** Isolated output for each cross-process race */
const sandbox = usePublicationSandbox();
/** Publishers whose lifetimes remain scoped to each test */
const start = usePublicationProcesses();

test.each(["before-stage", "after-displace"] as const)(
  "a competing process refuses the active owner at %s without restoring its workspace",
  async (barrier) => {
    const { output, parent } = sandbox;
    await publishOutput(output, first, false);
    const winner = start({ output, files: second, check: false, barrier });
    const paused = await winner.paused;
    const entries = (await readdir(parent)).sort();
    const competitor = await start({ output, files: first, check: false }).completed;
    expect(competitor).toMatchObject({ kind: "refused", failure: { code: "output-conflict" } });
    const checked = await start({ output, files: first, check: true }).completed;
    expect(checked).toMatchObject({ kind: "refused", failure: { code: "output-conflict" } });
    expect((await readdir(parent)).sort()).toEqual(entries);
    if (barrier === "after-displace") {
      expect(entries).not.toContain("out");
      expect(await readFile(join(paused ?? "", "previous/typescript/contract.ts"), "utf8")).toBe(
        "first\n",
      );
      expect(await readdir(parent)).not.toContain("out");
    } else await expectPublishedTree(output, first);
    winner.child.send("continue");
    expect(await winner.completed).toEqual({
      kind: "published",
      receipt: { changed: true, retainedPaths: [] },
    });
    await expectPublishedTree(output, second);
    expect(await readdir(parent)).toEqual(["out"]);
  },
);

test.each([false, true])(
  "a fresh destination with existing empty directory %s has one owner",
  async (existing) => {
    const { output, parent } = sandbox;
    if (existing) await mkdir(output);
    const winner = start({ output, files: first, check: false, barrier: "before-stage" });
    await winner.paused;
    expect(await start({ output, files: second, check: false }).completed).toMatchObject({
      kind: "refused",
      failure: { code: "output-conflict" },
    });
    expect(await start({ output, files: first, check: true }).completed).toMatchObject({
      kind: "refused",
      failure: { code: "output-conflict" },
    });
    winner.child.send("continue");
    expect(await winner.completed).toMatchObject({ kind: "published", receipt: { changed: true } });
    await expectPublishedTree(output, first);
    expect(await readdir(parent)).toEqual(["out"]);
  },
);

test("equivalent output paths through a parent symbolic link share exclusive ownership", async () => {
  const { output, parent } = sandbox;
  const alias = join(parent, "alias");
  await symlink(parent, alias, "dir");
  const winner = start({ output, files: first, check: false, barrier: "before-stage" });
  await winner.paused;
  const equivalent = join(alias, basename(output));
  expect(await start({ output: equivalent, files: second, check: false }).completed).toMatchObject({
    kind: "refused",
    failure: { code: "output-conflict" },
  });
  expect((await publishOutput(equivalent, first, true)).unwrapErr().code).toBe("output-conflict");
  winner.child.send("continue");
  expect(await winner.completed).toMatchObject({ kind: "published" });
  await expectPublishedTree(output, first);
  expect((await readdir(parent)).sort()).toEqual(["alias", "out"]);
});

test("check mode refuses ownership acquired after its initial probe", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  const checker = start({ output, files: first, check: true, barrier: "during-check" });
  await checker.paused;
  const winner = start({ output, files: second, check: false, barrier: "before-stage" });
  await winner.paused;
  const entries = (await readdir(parent)).sort();
  checker.child.send("continue");
  expect(await checker.completed).toMatchObject({
    kind: "refused",
    failure: { code: "output-conflict" },
  });
  expect((await readdir(parent)).sort()).toEqual(entries);
  await expectPublishedTree(output, first);
  winner.child.send("continue");
  expect(await winner.completed).toMatchObject({ kind: "published" });
  await expectPublishedTree(output, second);
  expect(await readdir(parent)).toEqual(["out"]);
});

test("independent checks perform no destination or ownership mutation", async () => {
  const { output, parent } = sandbox;
  await publishOutput(output, first, false);
  expect(await start({ output, files: first, check: true }).completed).toEqual({
    kind: "published",
    receipt: { changed: false, retainedPaths: [] },
  });
  expect(await start({ output, files: second, check: true }).completed).toMatchObject({
    kind: "refused",
    failure: { code: "output-drift" },
  });
  expect(
    await start({ output: join(parent, "missing/nested/out"), files: first, check: true })
      .completed,
  ).toMatchObject({ kind: "refused", failure: { code: "output-drift" } });
  await expectPublishedTree(output, first);
  expect(await readdir(parent)).toEqual(["out"]);
});
