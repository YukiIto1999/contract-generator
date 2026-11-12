import type { Origin } from "./contract-model.js";

/** HTTP parameter placement outside the request body */
export interface HttpParameter {
  /** Canonical operation input field */
  readonly parameter: string;
  /** HTTP request location */
  readonly location: "path" | "query" | "header";
  /** Wire parameter name */
  readonly wireName: string;
  /** Original mapping declaration */
  readonly origin: Origin;
}

/** Request body ownership without implicit parameter copying */
export type HttpBody =
  | { readonly kind: "none" }
  | { readonly kind: "parameters" }
  | { readonly kind: "parameter"; readonly parameter: string };

/** Unique response selector for one public outcome */
export interface HttpResult {
  /** Canonical outcome name */
  readonly outcome: string;
  /** Exact declared HTTP status */
  readonly status: number;
  /** Declared media type absent only for a bodyless result */
  readonly mediaType?: string;
  /** Required lowercase header names and exact values */
  readonly headers: Readonly<Record<string, string>>;
  /** Original mapping declaration */
  readonly origin: Origin;
}

/** Complete HTTP interpretation of a public operation */
export interface HttpBinding {
  /** Uppercase HTTP method */
  readonly method: string;
  /** Absolute route template relative to the injected service origin */
  readonly path: string;
  /** Body placement */
  readonly body: HttpBody;
  /** Declared body media type */
  readonly requestMediaType: string;
  /** Nonbody parameter placements */
  readonly parameters: readonly HttpParameter[];
  /** Exhaustive unambiguous result mappings */
  readonly results: readonly HttpResult[];
  /** Original operation mapping */
  readonly origin: Origin;
}

/** Complete transport-neutral IPC interpretation of a public operation */
export interface IpcBinding {
  /** Command name supplied to the injected transport */
  readonly command: string;
  /** Exhaustive unique result tags */
  readonly results: readonly {
    readonly outcome: string;
    readonly tag: string;
    readonly origin: Origin;
  }[];
  /** Original operation mapping */
  readonly origin: Origin;
}
