import {
  getRelativePathFromDirectory,
  getSourceLocation,
  type DiagnosticTarget,
  type Namespace,
  type Program,
} from "@typespec/compiler";
import type { Origin } from "../model/contract-model.js";

/** Coordinates used when neither the declaration nor the selected namespace has a source file */
const syntheticOrigin: Origin = { file: "<contract>", start: 0, end: 0, line: 1, column: 1 };

/**
 * Project-relative source path with stable external-package identity
 * @param program - Compiler program supplying the project root
 * @param path - Compiler-owned absolute or virtual source path
 * @returns Slash-separated relative source identity without checkout-root leakage
 */
export function relativeSourcePath(program: Program, path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const dependency = normalized.lastIndexOf("/node_modules/");
  if (dependency >= 0) return normalized.slice(dependency + 1);
  return getRelativePathFromDirectory(program.projectRoot, normalized, false).replaceAll("\\", "/");
}

/**
 * Relative declaration coordinates with a selected-source fallback for intrinsics
 * @param program - Compiler program supplying source files
 * @param namespace - Selected namespace supplying the fallback location
 * @param target - Source declaration or application
 * @returns Original compiler coordinates independent of absolute checkout root
 */
export function originOf(
  program: Program,
  namespace: Namespace | undefined,
  target: DiagnosticTarget,
): Origin {
  const location = getSourceLocation(target);
  const selected = namespace ? getSourceLocation(namespace) : undefined;
  const source = location && !location.isSynthetic ? location : selected;
  if (!source || source.isSynthetic) return syntheticOrigin;
  const position = source.file.getLineAndCharacterOfPosition(source.pos);
  return {
    file: relativeSourcePath(program, source.file.path),
    start: source.pos,
    end: source.end,
    line: position.line + 1,
    column: position.character + 1,
  };
}

/**
 * Original compiler diagnostic target recovered from normalized coordinates
 * @param program - Compiler program supplying source files
 * @param namespace - Selected namespace used for synthetic declarations
 * @param origin - Project-relative source location from the private model
 * @returns Original source span or the namespace for synthetic declarations
 */
export function targetAtOrigin(
  program: Program,
  namespace: Namespace | undefined,
  origin: Origin,
): DiagnosticTarget {
  const source = [...program.sourceFiles.values()].find(
    (candidate) => relativeSourcePath(program, candidate.file.path) === origin.file,
  );
  return source
    ? { file: source.file, pos: origin.start, end: origin.end }
    : (namespace ?? program.getGlobalNamespaceType());
}
