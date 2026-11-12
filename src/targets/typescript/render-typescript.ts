import { Err, Ok, type Result } from "ts-results-es";
import type {
  ContractModel,
  EmissionOptions,
  GeneratedFile,
  GenerationIssue,
} from "../../model/contract-model.js";
import { renderClient } from "./render-client.js";
import { renderContract } from "./render-contract.js";
import { renderProvider } from "./render-provider.js";
import { publicTypeName } from "./target-names.js";
import { validateModel } from "./validate-model.js";

/**
 * Deterministic TypeScript contract publication without filesystem effects
 * @param model - Resolved private contract vocabulary
 * @param options - Caller-owned language integration
 * @returns Complete target files or source-addressed generation failures
 */
export function renderTypeScript(
  model: ContractModel,
  options: EmissionOptions,
): Result<readonly GeneratedFile[], readonly GenerationIssue[]> {
  const issues = validateModel(model, options);
  if (issues.length > 0) return Err(issues);
  const target: ContractModel = {
    ...model,
    types: model.types.map((type) => ({ ...type, name: publicTypeName(type.name) })),
  };
  const effectModule = options.typescriptEffectModule ?? "";
  return Ok([
    { path: "typescript/contract.ts", content: renderContract(target) },
    { path: "typescript/provider.ts", content: renderProvider(target, effectModule) },
    { path: "typescript/client.ts", content: renderClient(target, effectModule) },
  ]);
}
