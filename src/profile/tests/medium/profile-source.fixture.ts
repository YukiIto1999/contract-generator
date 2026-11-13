import { fileURLToPath } from "node:url";
import type { Program } from "@typespec/compiler";
import { createTester, mockFile, type Tester } from "@typespec/compiler/testing";
import type { Result } from "ts-results-es";
import { expect } from "vite-plus/test";
import declarations from "../../../../lib/main.tsp?raw";
import commonFixture from "../../../../tests/fixtures/contracts/main.tsp?raw";
import type {
  ContractModel,
  GenerationIssue,
  ObjectType,
  ScalarType,
} from "../../../model/contract-model.js";
import { compileContract } from "../../compile-contract.js";
import { $decorators, $lib } from "../../library.js";

/** Real compiler test filesystem with the actual decorator implementation */
export const tester: Tester = createTester(
  fileURLToPath(new URL("../../../../", import.meta.url)),
  {
    libraries: [],
  },
)
  .files({
    "lib/main.tsp": declarations,
    "dist/index.js": mockFile.js({ $lib, $decorators }),
    "tests/fixtures/contracts/main.tsp": commonFixture,
  })
  .import("./lib/main.tsp")
  .using("ContractGenerator");

/** Common fixture imported before profile usings as TypeSpec requires */
export const fixtureTester: Tester = tester.import("./tests/fixtures/contracts/main.tsp");

/**
 * Actual TypeSpec compilation followed by the consumer-facing profile seam
 * @param source - Complete source declarations with an explicit namespace
 * @param namespace - Selected public namespace
 * @param instance - Real compiler tester with the profile library loaded
 * @returns Compiler program and the normalized contract Result
 */
export async function compileSource(
  source: string,
  namespace = "Public",
  instance: Tester = tester,
): Promise<{
  readonly program: Program;
  readonly result: Result<ContractModel, readonly GenerationIssue[]>;
}> {
  const [compiled] = await instance.compileAndDiagnose(source, {
    compilerOptions: { noEmit: true },
  });
  return { program: compiled.program, result: compileContract(compiled.program, namespace) };
}

/**
 * Successful semantic extraction with diagnostics preserved in assertion failures
 * @param source - Actual TypeSpec declarations
 * @param namespace - Selected public namespace
 * @param instance - Real compiler tester with the profile library loaded
 * @returns Complete normalized private model
 */
export async function modelFrom(
  source: string,
  namespace = "Public",
  instance: Tester = tester,
): Promise<ContractModel> {
  const { result } = await compileSource(source, namespace, instance);
  expect(result.isOk(), result.isErr() ? JSON.stringify(result.error) : "").toBe(true);
  return result.unwrap();
}

/**
 * Invalid declarations observed through the generation Result rather than exceptions
 * @param source - Actual malformed profile source
 * @returns Expected generation issues and their original compiler program
 */
export async function issuesFrom(
  source: string,
): Promise<{ readonly issues: readonly GenerationIssue[]; readonly program: Program }> {
  const { result, program } = await compileSource(source);
  expect(result.isErr()).toBe(true);
  return { issues: result.unwrapErr(), program };
}

/**
 * Failure rules reported for a malformed declaration
 * @param source - Actual malformed profile source
 * @returns The rule code of every reported generation issue
 */
export async function codesFrom(source: string): Promise<readonly string[]> {
  const { issues } = await issuesFrom(source);
  return issues.map((issue) => issue.code);
}

/**
 * Named scalar lookup with a type-aware assertion
 * @param model - Complete compiled contract
 * @param name - Canonical public type name
 * @returns Scalar node at the public extraction seam
 * @throws {@link Error} the contract holds no scalar with that name
 */
export function scalarFrom(model: ContractModel, name: string): ScalarType {
  const node = model.types.find((type) => type.name === name);
  if (node?.kind !== "scalar") throw new Error(`Missing scalar ${name}`);
  return node;
}

/**
 * Named object lookup with a type-aware assertion
 * @param model - Complete compiled contract
 * @param name - Canonical public type name
 * @returns Object node at the public extraction seam
 * @throws {@link Error} the contract holds no object with that name
 */
export function objectFrom(model: ContractModel, name: string): ObjectType {
  const node = model.types.find((type) => type.name === name);
  if (node?.kind !== "object") throw new Error(`Missing object ${name}`);
  return node;
}

/**
 * Complete HTTP-only operation with independently configurable result declarations
 * @param mappings - Actual result mapping decorator applications
 * @returns Real TypeSpec source with two same-shaped payload paths and one void path
 */
export function httpSource(mappings: string): string {
  return `namespace Public;
    model Payload { value: string; }
    @outcomes union Results { first: Payload, second: Payload, done: void }
    op execute(): Results;
    @@publish(execute, #["http"]);
    @@httpBinding(execute, "GET", "/execute");
    ${mappings}
    @@httpResult(execute, "done", 204);`;
}
