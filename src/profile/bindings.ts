import type { HttpBinding, IpcBinding } from "../model/binding-model.js";
import type { Binding } from "../model/contract-model.js";
import type { BindingContext, BindingInput } from "./binding-context.js";
import { compileHttp } from "./http-binding.js";
import { compileIpc } from "./ipc-binding.js";
import { operationMetadata } from "./metadata.js";

/** Published transport interpretations after whole-operation validation */
export interface CompiledBindings {
  /** Complete HTTP interpretation, present exactly when the operation is published over HTTP */
  readonly http?: HttpBinding;
  /** Complete IPC interpretation, present exactly when the operation is published over IPC */
  readonly ipc?: IpcBinding;
}

/**
 * Complete binding validation before any target receives an operation
 * @param input - Normalized operation facts and services
 * @returns Each published binding in full; no binding is returned unless the publication declared it, and an operation without any publication reports a failure
 */
export function compileBindings(input: BindingInput): CompiledBindings {
  const context: BindingContext = {
    ...input,
    metadata: operationMetadata(input.program, input.operation),
  };
  const publications = declaredPublications(context);
  const http = publications.has("http") ? compileHttp(context) : undefined;
  const ipc = publications.has("ipc") ? compileIpc(context) : undefined;
  rejectUnpublishedMetadata(context, publications);
  return { ...(http ? { http } : {}), ...(ipc ? { ipc } : {}) };
}

/**
 * Required transports from the single publication declaration
 * @param context - Binding context of the operation
 * @returns Transports the operation must be published over
 */
function declaredPublications(context: BindingContext): ReadonlySet<Binding> {
  const { issue, metadata, operation } = context;
  if (metadata.publications.length !== 1)
    issue(
      "publication-count",
      operation,
      "Every public operation requires exactly one @publish declaration",
    );
  const publications = new Set(metadata.publications.flatMap((entry) => entry.value));
  if (publications.size === 0)
    issue("missing-binding", operation, "A public operation must require at least one binding");
  for (const entry of metadata.publications) {
    if (entry.value.length !== new Set(entry.value).size)
      issue("duplicate-binding", entry.target, "@publish lists the same binding more than once");
  }
  return publications;
}

/**
 * Binding metadata that has no publication to belong to
 * @param context - Binding context of the operation
 * @param publications - Transports the operation must be published over
 */
function rejectUnpublishedMetadata(
  context: BindingContext,
  publications: ReadonlySet<Binding>,
): void {
  const { issue, metadata, operation } = context;
  if (
    !publications.has("http") &&
    (metadata.http.length || metadata.parameters.length || metadata.httpResults.length)
  )
    issue("unpublished-binding", operation, "HTTP metadata requires an explicit http publication");
  if (!publications.has("ipc") && (metadata.ipc.length || metadata.ipcResults.length))
    issue("unpublished-binding", operation, "IPC metadata requires an explicit ipc publication");
}
