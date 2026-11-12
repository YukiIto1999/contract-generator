import { readFile } from "node:fs/promises";
import type {
  ContractModel,
  EmissionOptions,
  GeneratedFile,
} from "../../../src/model/contract-model.js";
import { renderTypeScript } from "../../../src/targets/typescript/render-typescript.js";

/** Actual generated consumer fixture without a second contract implementation
 * @param model - Canonical compiled contract
 * @param options - Target integration with caller-owned Effect module
 * @returns Generated outputs and handwritten consumer fixture files
 */
export async function typescriptFixtureFiles(
  model: ContractModel,
  options: EmissionOptions,
): Promise<readonly GeneratedFile[]> {
  const result = renderTypeScript(model, { ...options, typescriptEffectModule: "./effect.js" });
  if (result.isErr()) throw new Error(JSON.stringify(result.error));
  const files: GeneratedFile[] = [...result.value];
  for (const name of [
    "effect.ts",
    "check.ts",
    "host.ts",
    "consumer-fixture.ts",
    "consumer-values.ts",
    "consumer-direct.ts",
    "consumer-http.ts",
    "consumer-network.ts",
    "consumer.ts",
    "driver.ts",
    "type-contract.ts",
    "codec-only.ts",
  ]) {
    files.push({
      path: `typescript/${name}`,
      content: await readFile(new URL(name, import.meta.url), "utf8"),
    });
  }
  files.push({ path: "typescript/package.json", content: '{"private":true,"type":"module"}\n' });
  files.push({
    path: "typescript/tsconfig.json",
    content:
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2023",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            verbatimModuleSyntax: true,
            skipLibCheck: true,
            types: ["node"],
            lib: ["ES2023", "DOM", "DOM.Iterable"],
            outDir: "../dist",
          },
          include: ["*.ts"],
        },
        null,
        2,
      ) + "\n",
  });
  files.push({
    path: "typescript/codec-tsconfig.json",
    content:
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2023",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            verbatimModuleSyntax: true,
            skipLibCheck: true,
            types: [],
            lib: ["ES2023", "DOM"],
            outDir: "../pure-dist",
          },
          files: ["contract.ts", "codec-only.ts"],
        },
        null,
        2,
      ) + "\n",
  });
  return files;
}
