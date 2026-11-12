import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "vite-plus/test";
import type { PreparationOptions } from "../../../scripts/native-fixtures/prepare.js";

/** Repository-shaped temporary directory with locked sources that exist only below it */
export interface NativeFixtureRepository {
  /** Root that owns `devenv.lock` and receives `work/` */
  root: string;
  /** Destination the preparation publishes into, absent until it is prepared */
  destination: string;
  /** Preparation options whose environment names the two source directories */
  options: PreparationOptions;
}

/** Content hash that the lock pins for every source */
export const pinnedHash = "sha256-" + "A".repeat(43) + "=";

/** Hashing that reports the pinned hash for any path, standing in for `nix hash path`
 * @returns The hash that the lock pins
 */
export function pinnedHashing(): Promise<string> {
  return Promise.resolve(pinnedHash);
}

/** One locked GitHub source node of the lock
 * @param repo - Repository named by the input
 * @returns Lock node pinning the repository to a commit and content hash
 */
function lockNode(repo: string): object {
  return {
    locked: {
      type: "github",
      owner: "YukiIto1999",
      repo,
      rev: "a".repeat(40),
      narHash: pinnedHash,
    },
  };
}

/** Lock document that pins both native dependency inputs
 * @returns Input graph in the shape `devenv.lock` has
 */
export function pinnedLock(): object {
  return {
    root: "root",
    nodes: {
      root: {
        inputs: {
          "typemodeling-dotnet": "typemodeling-dotnet",
          "effectsystem-dotnet": "effectsystem-dotnet",
        },
      },
      "typemodeling-dotnet": lockNode("typemodeling-dotnet"),
      "effectsystem-dotnet": lockNode("effectsystem-dotnet"),
    },
  };
}

/** Source tree with its project file and a read-only file
 * @param directory - Source root to create
 * @param project - Project path relative to the source root
 */
async function writeSource(directory: string, project: string): Promise<void> {
  await mkdir(dirname(join(directory, project)), { recursive: true });
  await writeFile(join(directory, project), "<Project />\n");
  await writeFile(join(directory, "README.md"), "pinned\n");
  await chmod(join(directory, "README.md"), 0o444);
}

/** Temporary repository whose sources, lock and hashing never touch the real checkout
 * @returns Repository that is rebuilt before and removed after every test
 */
export function useNativeFixtureRepository(): NativeFixtureRepository {
  const repository: NativeFixtureRepository = {
    root: "",
    destination: "",
    options: { root: "", environment: {}, hashSource: pinnedHashing },
  };
  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "contract-generator-native-"));
    const typeModeling = join(root, "sources/typemodeling");
    const effectSystem = join(root, "sources/effectsystem");
    await writeSource(typeModeling, "src/TypeModeling/TypeModeling.csproj");
    await writeSource(effectSystem, "src/EffectSystem/EffectSystem.csproj");
    await writeFile(join(root, "devenv.lock"), JSON.stringify(pinnedLock()));
    repository.root = root;
    repository.destination = join(root, "work/native-dependencies");
    repository.options = {
      root,
      environment: {
        CONTRACT_GENERATOR_TYPEMODELING_SOURCE: typeModeling,
        CONTRACT_GENERATOR_EFFECTSYSTEM_SOURCE: effectSystem,
      },
      hashSource: pinnedHashing,
    };
  });
  afterEach(async () => {
    await rm(repository.root, { recursive: true, force: true });
  });
  return repository;
}
