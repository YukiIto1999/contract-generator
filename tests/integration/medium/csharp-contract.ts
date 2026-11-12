import { createTester, mockFile } from "@typespec/compiler/testing";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ContractModel } from "../../../src/model/contract-model.js";
import { compileContract } from "../../../src/profile/compile-contract.js";
import { $decorators, $lib } from "../../../src/profile/library.js";

/** Checkout root against which the fixture contracts are addressed */
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Canonical Sample contract */
export const sampleSource = "tests/fixtures/contracts/main.tsp";
/** Second fixture contract covering parameter, binary, selector, default and exact-number bindings */
export const featuresSource = "tests/fixtures/csharp/features.tsp";

/** Contract interpreted through the real TypeSpec frontend and the current profile
 * @param source - Checkout-relative TypeSpec source path
 * @param namespace - Selected public contract
 * @param text - Source text; the checkout file is read when omitted
 * @returns Normalized model
 * @throws {@link Error} A contract that the profile rejects
 */
export async function contractModel(
  source: string,
  namespace: string,
  text?: string,
): Promise<ContractModel> {
  const declarations = await readFile(new URL("../../../lib/main.tsp", import.meta.url), "utf8");
  const contract = text ?? (await readFile(new URL(`../../../${source}`, import.meta.url), "utf8"));
  const tester = createTester(projectRoot, { libraries: [] })
    .files({
      "lib/main.tsp": declarations,
      "dist/index.js": mockFile.js({ $lib, $decorators }),
      [source]: contract,
    })
    .import(`./${source}`);
  const [compiled] = await tester.compileAndDiagnose("", { compilerOptions: { noEmit: true } });
  const result = compileContract(compiled.program, namespace);
  if (result.isErr()) throw new Error(JSON.stringify(result.error));
  return result.value;
}
