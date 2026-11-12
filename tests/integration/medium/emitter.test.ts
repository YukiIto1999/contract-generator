import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { digests, generate, loadFixture } from "./emitter-support.js";

const timeout = 60_000;
let root: string;
let fixture: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "contract-generator-emitter-"));
  fixture = await loadFixture();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test(
  "a different checkout path and declaration order produce identical bytes",
  { timeout },
  async () => {
    const marker = "@outcomes\nunion DownloadOutcome";
    const index = fixture.indexOf(marker);
    expect(index).toBeGreaterThan(0);
    const reordered = fixture
      .slice(0, index)
      .replace("namespace Sample;\n", "namespace Sample;\n\n" + fixture.slice(index) + "\n");
    expect((await generate(join(root, "a"), fixture)).code).toBe(0);
    const moved = await generate(join(root, "nested/elsewhere/b"), reordered);
    expect(moved.code, moved.text).toBe(0);
    const left = await digests(join(root, "a/out"));
    expect(Object.keys(left)).toContain("typescript/contract.ts");
    expect(Object.keys(left)).toContain("csharp/types/ContractTypes.cs");
    expect(Object.keys(left)).toContain("rust/types/src/lib.rs");
    expect(await digests(join(root, "nested/elsewhere/b/out"))).toEqual(left);
    for (const path of Object.keys(left))
      expect(await readFile(join(root, "a/out", path), "utf8")).not.toContain(root);
  },
);

test(
  "a missing result binding fails with a source location and keeps the previous output",
  { timeout },
  async () => {
    const directory = join(root, "failure");
    expect((await generate(directory, fixture)).code).toBe(0);
    const before = await digests(join(directory, "out"));
    const broken = fixture.replace(
      '@@httpResult(submit, "queued", 202, "application/json");\n',
      "",
    );
    expect(broken).not.toBe(fixture);
    const failed = await generate(directory, broken);
    expect(failed.code).not.toBe(0);
    expect(failed.text).toMatch(/main\.tsp:\d+:\d+/);
    expect(failed.text).toContain("missing-outcome-binding");
    expect(failed.text).toMatch(/queued/i);
    expect(await digests(join(directory, "out"))).toEqual(before);
    expect((await readdir(directory)).sort()).toEqual(["main.tsp", "out", "tspconfig.yaml"]);
  },
);

test(
  "an unsafe route template fails with a source location and keeps the previous output",
  { timeout },
  async () => {
    const directory = join(root, "unsafe-route");
    expect((await generate(directory, fixture)).code).toBe(0);
    const before = await digests(join(directory, "out"));
    for (const route of ["//submit", "/submit/..", "/%2e%2E/submit"]) {
      const unsafe = fixture.replace(
        '@@httpBinding(submit, "POST", "/submit");',
        `@@httpBinding(submit, "POST", "${route}");`,
      );
      expect(unsafe, route).not.toBe(fixture);
      const failed = await generate(directory, unsafe);
      expect(failed.code, route).not.toBe(0);
      expect(failed.text, route).toMatch(/main\.tsp:\d+:\d+/);
      expect(failed.text, route).toContain("invalid-http-path");
      expect(await digests(join(directory, "out")), route).toEqual(before);
    }
    expect((await readdir(directory)).sort()).toEqual(["main.tsp", "out", "tspconfig.yaml"]);
  },
);

test(
  "check mode fails on a changed contract without rewriting the output",
  { timeout },
  async () => {
    const directory = join(root, "drift");
    expect((await generate(directory, fixture)).code).toBe(0);
    const before = await digests(join(directory, "out"));
    expect((await generate(directory, fixture, true)).code).toBe(0);
    const changed = fixture.replace("@maxLength(3)", "@maxLength(4)");
    expect(changed).not.toBe(fixture);
    const drift = await generate(directory, changed, true);
    expect(drift.code).not.toBe(0);
    expect(drift.text).toContain("output-drift");
    expect(await digests(join(directory, "out"))).toEqual(before);
  },
);
