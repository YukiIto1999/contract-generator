import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareNativeFixtures } from "./native-fixtures/prepare.ts";
import { nixHashPath } from "./native-fixtures/source.ts";

try {
  const prepared = await prepareNativeFixtures({
    root: join(dirname(fileURLToPath(import.meta.url)), ".."),
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
  }
} catch (error) {
  console.error("prepare-native-fixtures:", error);
  process.exitCode = 1;
}
