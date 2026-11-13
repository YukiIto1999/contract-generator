import { Err, Ok, type Result } from "ts-results-es";
import type {
  ContractModel,
  EmissionOptions,
  GeneratedFile,
  GenerationIssue,
} from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { rustRecursionLimit } from "./compiler-limits.js";
import { createContext } from "./context.js";
import { rustManifests } from "./dependencies.js";
import { renderBinary } from "./render-binary.js";
import { renderClient } from "./render-client.js";
import { renderProvider } from "./render-provider.js";
import { renderReadme } from "./render-readme.js";
import { renderTransport } from "./render-transport.js";
import { assembleTypes, renderTypes } from "./render-types.js";
import { renderWire } from "./render-wire.js";
import { rustIssues } from "./rust-issues.js";

/** Complete deterministic Rust contract emission without filesystem effects
 * @param model - Compiler-independent normalized public contract
 * @param options - Caller-owned language integration options
 * @returns All Rust dependency units or source-addressed generation issues
 */
export function renderRust(
  model: ContractModel,
  options: EmissionOptions,
): Result<readonly GeneratedFile[], readonly GenerationIssue[]> {
  const diagnostics = rustIssues(model, options.rustCratePrefix);
  if (diagnostics.length !== 0) return Err(diagnostics);
  const ctx = createContext(
    {
      ...model,
      types: model.types.toSorted((a, b) => compareText(a.id, b.id)),
      operations: model.operations.toSorted((a, b) => compareText(a.id, b.id)),
    },
    options.rustCratePrefix,
  );
  const allowance = `#![recursion_limit = "${rustRecursionLimit(model)}"]\n`;
  const files: GeneratedFile[] = [
    ...rustManifests(ctx.prefix),
    {
      path: "rust/types/src/lib.rs",
      content: allowance + assembleTypes(renderTypes(ctx) + renderWire(ctx) + renderBinary(ctx)),
    },
    { path: "rust/transport/src/lib.rs", content: allowance + renderTransport(ctx) },
    { path: "rust/provider/src/lib.rs", content: allowance + renderProvider(ctx) },
    { path: "rust/client/src/lib.rs", content: allowance + renderClient(ctx) },
    { path: "rust/README.md", content: renderReadme(ctx) },
  ];
  return Ok(files.toSorted((a, b) => compareText(a.path, b.path)));
}
