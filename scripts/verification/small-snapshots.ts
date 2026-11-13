import type { SnapshotEnvironment } from "vite-plus/test/runtime";

/** Snapshot storage of Small workers, which can neither read nor write snapshot files */
const smallSnapshots: SnapshotEnvironment = {
  getVersion: () => "1",
  getHeader: () => "",
  resolvePath: async (filepath) => `${filepath}.snap`,
  resolveRawPath: async (_testPath, rawPath) => rawPath,
  saveSnapshotFile: async (filepath) => {
    throw new Error(`Small tests cannot persist snapshot ${filepath}; expected a Medium test`);
  },
  readSnapshotFile: async () => null,
  removeSnapshotFile: async () => undefined,
};

export default smallSnapshots;
