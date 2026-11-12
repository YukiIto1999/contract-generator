import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";
import { makeWritable } from "../../../scripts/native-fixtures/copy-sources.js";
import { prepareNativeFixtures } from "../../../scripts/native-fixtures/prepare.js";
import { useNativeFixtureRepository } from "./native-fixtures-support.js";

const run = promisify(execFile);
const repository = useNativeFixtureRepository();

/** Refusal that preparation reports for the repository
 * @param overrides - Options that replace the repository's own
 * @returns Category and message of the refusal
 * @throws {@link Error} Preparation succeeded although a refusal was expected
 */
async function refusalOf(
  overrides: Partial<typeof repository.options> = {},
): Promise<{ code: string; message: string }> {
  const result = await prepareNativeFixtures({ ...repository.options, ...overrides });
  if (result.isOk()) throw new Error("Preparation unexpectedly succeeded");
  return result.error;
}

test("preparation copies each pinned source as a writable tree with a provenance marker", async () => {
  const report = (await prepareNativeFixtures(repository.options)).unwrap();
  expect(report.sources.map((source) => source.dependency.input)).toEqual([
    "typemodeling-dotnet",
    "effectsystem-dotnet",
  ]);
  const { destination } = repository;
  expect((await readdir(destination)).sort()).toEqual([
    ".contract-generator-source.json",
    "effectsystem-dotnet",
    "typemodeling-dotnet",
  ]);
  const copied = join(destination, "typemodeling-dotnet");
  expect(await readFile(join(copied, "src/TypeModeling/TypeModeling.csproj"), "utf8")).toBe(
    "<Project />\n",
  );
  expect((await stat(join(copied, "README.md"))).mode & 0o200).toBe(0o200);
  const marker: unknown = JSON.parse(
    await readFile(join(copied, ".contract-generator-source.json"), "utf8"),
  );
  expect(marker).toMatchObject({
    input: "typemodeling-dotnet",
    repository: "https://github.com/YukiIto1999/typemodeling-dotnet.git",
    revision: "a".repeat(40),
  });
});

test("a second preparation replaces the owned tree and drops stale files", async () => {
  await prepareNativeFixtures(repository.options);
  const stale = join(repository.destination, "typemodeling-dotnet/stale.txt");
  await writeFile(stale, "left over\n");
  expect((await prepareNativeFixtures(repository.options)).isOk()).toBe(true);
  await expect(stat(stale)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(join(repository.root, "work"))).toEqual(["native-dependencies"]);
});

test("a destination without the ownership marker is refused and kept", async () => {
  await mkdir(repository.destination, { recursive: true });
  await writeFile(join(repository.destination, "notes.txt"), "mine\n");
  expect((await refusalOf()).code).toBe("unowned-destination");
  expect(await readdir(repository.destination)).toEqual(["notes.txt"]);
  expect(await readdir(join(repository.root, "work"))).toEqual(["native-dependencies"]);
});

test("a symbolic-link destination is refused and its target kept", async () => {
  const target = join(repository.root, "elsewhere");
  await mkdir(target);
  await writeFile(join(target, "keep.txt"), "mine\n");
  await mkdir(join(repository.root, "work"));
  await symlink(target, repository.destination);
  expect((await refusalOf()).code).toBe("unsafe-destination");
  expect(await readdir(target)).toEqual(["keep.txt"]);
});

test("an entry that preparation does not own beside the sources is refused and kept", async () => {
  await prepareNativeFixtures(repository.options);
  await writeFile(join(repository.destination, "extra.txt"), "mine\n");
  expect((await refusalOf()).code).toBe("unowned-entry");
  expect(await readFile(join(repository.destination, "extra.txt"), "utf8")).toBe("mine\n");
});

test("a work path that is not a directory is refused", async () => {
  await writeFile(join(repository.root, "work"), "not a directory\n");
  expect((await refusalOf()).code).toBe("unsafe-work-directory");
});

test("a source whose content hash differs from the lock is refused before anything is written", async () => {
  const refusal = await refusalOf({
    hashSource: () => Promise.resolve("sha256-" + "B".repeat(43) + "="),
  });
  expect(refusal.code).toBe("source-hash-mismatch");
  await expect(stat(join(repository.root, "work"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("a missing source variable asks for the devenv shell", async () => {
  const refusal = await refusalOf({ environment: {} });
  expect(refusal.code).toBe("missing-environment");
  expect(refusal.message).toContain("CONTRACT_GENERATOR_TYPEMODELING_SOURCE");
});

test("an input that the lock does not pin is refused", async () => {
  await writeFile(
    join(repository.root, "devenv.lock"),
    JSON.stringify({ root: "root", nodes: { root: {} } }),
  );
  expect((await refusalOf()).code).toBe("missing-source-lock");
});

test("a pinned source without its project file is refused", async () => {
  const withoutProject = {
    ...repository.options.environment,
    CONTRACT_GENERATOR_EFFECTSYSTEM_SOURCE: repository.root,
  };
  expect((await refusalOf({ environment: withoutProject })).code).toBe("missing-project");
});

test("a source entry that is neither file, directory nor link is refused", async () => {
  const fifo = join(repository.root, "pipe");
  await run("mkfifo", [fifo]);
  const result = await makeWritable(fifo);
  expect(result.isErr() && result.error.code).toBe("unsupported-entry");
});
