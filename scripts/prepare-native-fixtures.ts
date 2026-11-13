import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareNativeFixtures } from "./native-fixtures/prepare.ts";
import { auditNativePackages } from "./native-fixtures/restore-audit.ts";
import { nixHashPath } from "./native-fixtures/source.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const prepared = await prepareNativeFixtures({
    root,
    environment: process.env,
    hashSource: nixHashPath,
  });
  if (prepared.isErr()) {
    console.error(`prepare-native-fixtures: ${prepared.error.message}`);
    process.exitCode = 1;
  } else {
    console.log(`Prepared pinned native sources in ${prepared.value.destination}`);
    for (const source of prepared.value.sources) {
      console.log(`${source.dependency.input}: ${source.revision}`);
    }
    const audited = auditNativePackages(root, process.env);
    if (audited.isErr()) {
      console.error(`prepare-native-fixtures: ${audited.error}`);
      process.exitCode = 1;
    } else {
      console.log(`Audited ${audited.value.packages} NuGet packages`);
      console.log(`Receipt: ${audited.value.receipt}`);
    }
  }
} catch (error) {
  console.error("prepare-native-fixtures:", error);
  process.exitCode = 1;
}
