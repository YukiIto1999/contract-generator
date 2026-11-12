import { rm } from "node:fs/promises";
import { afterAll, beforeAll, test } from "vite-plus/test";
import { startHttpServer, type HttpServer } from "./csharp-process.js";
import {
  buildContract,
  detectCSharpToolchain,
  driverAssembly,
  type BuiltContract,
  type CSharpFixture,
  type NativeBuild,
} from "./csharp-toolchain.js";

/** Toolchain verdict evaluated once so an unavailable toolchain is reported rather than silently passing */
const toolchain = detectCSharpToolchain();
if (!toolchain.available)
  console.warn(
    `[csharp-native] NOT RUN: the generated C# was not compiled or executed because ${toolchain.reason}`,
  );

/** Test that runs only against the pinned native toolchain
 * @param name - Behavior under test
 * @param body - Test body
 * @param timeout - Ceiling in milliseconds; builds and processes run long on a shared workstation
 */
export function nativeTest(
  name: string,
  body: () => void | Promise<void>,
  timeout = 600_000,
): void {
  test.skipIf(!toolchain.available)(name, body, timeout);
}

/** Contract rendered and built once for the tests of one file */
export interface ContractSuite {
  /** Provisioned directories */
  fixture(): CSharpFixture;
  /** Build result of one driver project
   * @param project - Project file name
   */
  build(project: string): NativeBuild;
  /** Built assembly of one driver project
   * @param name - Project name without extension
   */
  driver(name: string): string;
}

/** Registering the build of a contract before the tests of the current file and its removal afterward
 * @param source - Checkout-relative TypeSpec source path
 * @param namespace - Selected public contract
 * @param projects - Driver project files to build
 * @param after - Cleanup that runs before the fixture directory is removed
 * @returns Accessors that are valid inside the tests
 */
export function useContract(
  source: string,
  namespace: string,
  projects: readonly string[],
  after: () => Promise<void> = async () => undefined,
): ContractSuite {
  let state: BuiltContract | undefined;
  if (toolchain.available)
    beforeAll(async () => {
      state = await buildContract(source, namespace, projects);
    }, 1_200_000);
  afterAll(async () => {
    await after();
    if (state) await rm(state.fixture.root, { recursive: true, force: true });
  });
  const current = (): BuiltContract => {
    if (!state) throw new Error("The contract was not built");
    return state;
  };
  return {
    fixture: () => current().fixture,
    build: (project) => current().builds.get(project)!,
    driver: (name) => driverAssembly(current().fixture, name),
  };
}

/** Registering a real provider server for the tests of the current file and its shutdown afterward
 * @param suite - Built contract that contains `OperationDriver`
 * @returns Accessor that is valid inside the tests
 * @throws {@link Error} An accessor used before the server started
 */
export function useServer(suite: ContractSuite): () => HttpServer {
  let server: HttpServer | undefined;
  if (toolchain.available)
    beforeAll(async () => {
      server = await startHttpServer(suite.driver("OperationDriver"));
    }, 600_000);
  afterAll(async () => {
    if (server) await server.stop();
  });
  return () => {
    if (!server) throw new Error("The server was not started");
    return server;
  };
}
