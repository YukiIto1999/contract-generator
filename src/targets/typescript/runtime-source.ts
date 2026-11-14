import { runtimeCodecSource } from "./runtime-codec.js";
import { runtimeJsonSource } from "./runtime-json.js";
import { runtimeNumbersSource } from "./runtime-numbers.js";
import { runtimeTemporalSource } from "./runtime-temporal.js";
import { runtimeTraversalSource } from "./runtime-traversal.js";
import { runtimeTypesSource } from "./runtime-types.js";
import { runtimeValuesSource } from "./runtime-values.js";

/** Pure browser-compatible support emitted beside specialized declaration readers */
export const runtimeSource: string = [
  runtimeTypesSource,
  runtimeValuesSource,
  runtimeJsonSource,
  runtimeTraversalSource,
  runtimeNumbersSource,
  runtimeTemporalSource,
  runtimeCodecSource,
].join("\n");

/** Top-level declaration forms of the emitted support that a contract declaration must not shadow */
const topLevelDeclaration =
  /^(?:export\s+)?(?:declare\s+)?(?:const|let|function\s*\*?|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm;

/** Named imports of the emitted support */
const namedImport = /^import\s+\{([^}]*)\}/gm;

/**
 * Identifiers bound at the top level of the emitted support
 * @param source - Emitted support source
 * @returns Declared and imported names in source order without duplicates
 */
function declaredNames(source: string): readonly string[] {
  const declared = [...source.matchAll(topLevelDeclaration)].map((match) => match[1]!);
  const imported = [...source.matchAll(namedImport)].flatMap((match) =>
    match[1]!
      .split(",")
      .map((entry) => entry.replace(/^\s*type\s+/, "").trim())
      .filter((entry) => entry !== ""),
  );
  return [...new Set([...imported, ...declared])];
}

/** Every identifier the emitted support binds, derived from the support itself so that it cannot drift */
export const declaredRuntimeNames: readonly string[] = declaredNames(runtimeSource);
