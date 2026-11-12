import * as results from "ts-results-es";
import * as losslessJson from "lossless-json";
import * as base from "@scure/base";
import * as re2js from "re2js";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import type { ContractModel, EmissionOptions, GeneratedFile } from "../../model/contract-model.js";
import { renderTypeScript } from "./render-typescript.js";

/** Caller-owned Effect integration executed beside the generated modules */
const effectModule = `
import type { AsyncResult } from "ts-results-es";
export type Effect<Env, E, A> = (env: Env, signal: AbortSignal, deadlineAt: number) => AsyncResult<A, E>;
export function deferEffect<Env, E, A>(run: (env: Env, signal: AbortSignal, deadlineAt: number) => AsyncResult<A, E>): Effect<Env, E, A> {
  return (env, signal, deadlineAt) => run(env, signal, deadlineAt);
}
`;

/** Exports of a loaded module */
export type LoadedModule = Readonly<Record<string, unknown>>;

/** Generated modules executed in-process */
export interface LoadedContract {
  /** Types, codecs and operation payload codecs */
  readonly contract: LoadedModule;
  /** HTTP and IPC clients with the bundled Fetch transport */
  readonly client: LoadedModule;
  /** Provider with direct, HTTP and IPC entrypoints */
  readonly provider: LoadedModule;
}

/** Options with the in-memory Effect module */
const options: EmissionOptions = {
  targets: ["typescript"],
  typescriptEffectModule: "./effect.js",
  csharpNamespace: "Sample",
  rustCratePrefix: "sample",
};

/** Real external modules loaded before memory-only generated execution */
const dependencies: Readonly<Record<string, LoadedModule>> = {
  "ts-results-es": results,
  "lossless-json": losslessJson,
  "@scure/base": base,
  re2js,
};

/**
 * Eager dependency resolution without filesystem module loading
 * @param name - External module specifier emitted by the generator
 * @returns Already loaded real dependency
 * @throws {@link Error} Undeclared generated dependency
 */
function dependency(name: string): LoadedModule {
  const module = Object.hasOwn(dependencies, name) ? dependencies[name] : undefined;
  if (module === undefined) throw new Error(`Unknown generated dependency ${name}`);
  return module;
}

/**
 * Transpilation and execution of generated modules without touching the filesystem
 * @param files - Generated and support sources by module path
 * @returns Exports of the requested module
 * @throws {@link Error} Generated source that does not transpile or execute
 */
function execute(files: ReadonlyMap<string, string>): (name: string) => LoadedModule {
  const loaded = new Map<string, LoadedModule>();
  const load = (name: string): LoadedModule => {
    const cached = loaded.get(name);
    if (cached !== undefined) return cached;
    const source = files.get(name);
    if (source === undefined) throw new Error(`Unknown generated module ${name}`);
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    });
    const exports: Record<string, unknown> = {};
    loaded.set(name, exports);
    const run = runInThisContext(`(function (exports, require) {${outputText}\n})`) as (
      exports: Record<string, unknown>,
      require: (specifier: string) => unknown,
    ) => void;
    run(exports, (specifier) =>
      specifier.startsWith("./")
        ? load(specifier.slice(2).replace(/\.js$/, ""))
        : dependency(specifier),
    );
    return exports;
  };
  return load;
}

/**
 * Generated TypeScript of a model executed in-process
 * @param model - Contract model
 * @returns Executed contract, client and provider modules
 * @throws {@link Error} Model that the target rejects
 */
export function loadGenerated(model: ContractModel): LoadedContract {
  const rendered = renderTypeScript(model, options);
  if (rendered.isErr()) throw new Error(JSON.stringify(rendered.error));
  const files = new Map<string, string>(
    rendered.value.map((file: GeneratedFile) => [
      file.path.replace(/^typescript\//, "").replace(/\.ts$/, ""),
      file.content,
    ]),
  );
  files.set("effect", effectModule);
  const load = execute(files);
  return { contract: load("contract"), client: load("client"), provider: load("provider") };
}
