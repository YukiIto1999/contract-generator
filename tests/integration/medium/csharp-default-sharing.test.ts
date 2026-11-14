import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vite-plus/test";
import { runDriver } from "./csharp-process.js";
import { nativeTest, useContract } from "./csharp-suite.js";
import { buildCSharpProject, generatedDiagnostics } from "./csharp-toolchain.js";

/** Generated contract whose provider defaults sit below shared objects, arrays and unions */
const contract = useContract("tests/fixtures/csharp/default-sharing.tsp", "DefaultSharing", [
  "SharingDriver.csproj",
]);

/** One native observation
 * @param request - Mode and parameters of the driver request
 * @returns The driver's observation
 */
async function observe(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const [observation] = await runDriver(contract.driver("SharingDriver"), [request]);
  return observation!;
}

/** Generated provider-default source without the case label or switch arm of one union variant
 * @param source - Generated types source
 * @param variant - Union and variant as the consumer writes them, such as `Tagged.Plain`; each segment may carry the generator's `@` escape
 * @returns Source whose provider-default region lacks the line with that variant's type pattern, an optional designation and `:` or `=>`
 * @throws {@link Error} Region without such a line, which would leave the compiler nothing to reject
 */
function withoutVariant(source: string, variant: string): string {
  const start = source.indexOf("internal static class ProviderDefaults");
  const spelled = variant
    .split(".")
    .map((segment) => `@?${segment}`)
    .join("\\.");
  const pattern = new RegExp(`^[^\\n]*${spelled}(?:\\s+\\w+)?\\s*(?::|=>)[^\\n]*\\n`, "m");
  const defaults = start < 0 ? "" : source.slice(start);
  if (!pattern.test(defaults))
    throw new Error(`The generated provider defaults have no case or arm for ${variant}`);
  return source.slice(0, start) + defaults.replace(pattern, "");
}

nativeTest("builds the generated types and the driver without any compiler diagnostic", () => {
  const build = contract.build("SharingDriver.csproj");
  expect(build.status, build.output).toBe(0);
  expect(generatedDiagnostics(build), build.output).toEqual([]);
});

nativeTest(
  "fills each shared child once, keeps distinct equal children apart and leaves the input unchanged",
  async () => {
    expect(await observe({ mode: "graph" })).toEqual({
      objectShared: true,
      objectFilled: true,
      objectReplaced: true,
      objectDistinct: true,
      objectUnchanged: true,
      nullableShared: true,
      nullPreserved: true,
      listShared: true,
      listDistinct: true,
      listReplaced: true,
      listUnchanged: true,
      listElements: true,
      tagShared: true,
      tagFilled: true,
      tagReplaced: true,
      tagDistinct: true,
      tagPayloadShared: true,
      tagUnchanged: true,
      inputUnchanged: true,
    });
  },
);

nativeTest("returns the original input and children when no default fills anywhere", async () => {
  expect(await observe({ mode: "untouched" })).toEqual({
    inputIdentity: true,
    sharingIdentity: true,
  });
});

for (const kind of ["object", "array", "union"] as const) {
  nativeTest(
    `applies defaults once per distinct child across 20000 ${kind} levels that each refer to the next twice`,
    async () => {
      expect(await observe({ mode: "dag", kind, depth: 20_000 })).toEqual({
        completed: true,
        levels: 20_000,
        shared: true,
        filled: true,
        sourceUnchanged: true,
      });
    },
  );
}

nativeTest(
  "fails generated compilation when default application omits a union variant",
  async () => {
    const file = join(contract.fixture().generatedRoot, "csharp/types/ContractTypes.cs");
    const original = await readFile(file, "utf8");
    try {
      await writeFile(file, withoutVariant(original, "Tagged.Plain"));
      const build = buildCSharpProject(contract.fixture(), "SharingDriver.csproj");
      expect(build.status, build.output).not.toBe(0);
      const errors = generatedDiagnostics(build).filter(({ severity }) => severity === "error");
      expect(
        errors.map(({ code }) => code),
        build.output,
      ).toEqual(["CS8509"]);
    } finally {
      await writeFile(file, original);
    }
  },
);
