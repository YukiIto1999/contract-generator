import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { digests, generate, loadFixture } from "./emitter-support.js";

const run = promisify(execFile);
const cli = resolve(import.meta.dirname, "../../../node_modules/@typespec/compiler/cmd/tsp.js");
const timeout = 60_000;
let root: string;
let fixture: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "contract-generator-safe-pattern-"));
  fixture = await loadFixture();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test.each([
  "typescript",
  "csharp",
  "rust",
  "typescript, csharp",
  "typescript, rust",
  "csharp, rust",
  "typescript, csharp, rust",
])(
  "unsupported profile patterns preserve publication for targets [%s]",
  { timeout },
  async (targets) => {
    const directory = join(root, targets.replaceAll(", ", "-"));
    const baseline = await generate(directory, fixture);
    expect(baseline.code, baseline.text).toBe(0);
    const configPath = join(directory, "tspconfig.yaml");
    const config = await readFile(configPath, "utf8");
    expect(config).toContain("targets: [typescript, csharp, rust]");
    await writeFile(
      configPath,
      config.replace("targets: [typescript, csharp, rust]", `targets: [${targets}]`),
    );
    await run(process.execPath, [cli, "compile", "main.tsp"], { cwd: directory });
    const before = await digests(join(directory, "out"));
    expect(Object.keys(before).length).toBeGreaterThan(0);
    const broken = `${fixture}
@minLength(2) @pattern("^(?=a)a+$") scalar UnsafePattern extends string;
model UnsafePatternInput { @providerDefault("!") value?: UnsafePattern; }
`;
    await writeFile(join(directory, "main.tsp"), broken);
    let code = 0;
    let text = "";
    try {
      const result = await run(process.execPath, [cli, "compile", "main.tsp"], { cwd: directory });
      text = result.stdout + result.stderr;
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string };
      code = failed.code ?? -1;
      text = (failed.stdout ?? "") + (failed.stderr ?? "");
    }
    expect(code, text).not.toBe(0);
    expect(text).toContain("unsupported-pattern");
    expect(text).not.toContain("invalid-default");
    expect(text).toMatch(/main\.tsp:\d+:\d+/);
    expect(await digests(join(directory, "out"))).toEqual(before);
    expect((await readdir(directory)).sort()).toEqual(["main.tsp", "out", "tspconfig.yaml"]);
  },
);
