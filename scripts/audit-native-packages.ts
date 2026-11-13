import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditNativePackages } from "./native-fixtures/restore-audit.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const audited = auditNativePackages(root, process.env);
  if (audited.isErr()) {
    console.error(`audit-native-packages: ${audited.error}`);
    process.exitCode = 1;
  } else {
    console.log(`Audited ${audited.value.packages} NuGet packages`);
    console.log(`Receipt: ${audited.value.receipt}`);
  }
} catch (error) {
  console.error("audit-native-packages:", error);
  process.exitCode = 1;
}
