import { expect, test } from "vite-plus/test";
import {
  auditFindings,
  auditSettingsProblems,
  bounded,
  parseReceipt,
  redactCredentials,
  restoredPackages,
  serializeReceipt,
  unauditedPackages,
  type AssetsDocument,
  type PackageHash,
} from "./package-audit.ts";

/** Evaluated restore settings of a project whose restore audits every package */
type Restore = NonNullable<NonNullable<AssetsDocument["project"]>["restore"]>;
const auditingRestore: Restore = {
  restoreAuditProperties: { enableAudit: "true", auditLevel: "low", auditMode: "all" },
  warningProperties: { noWarn: ["NU1701"] },
};

const instant = new Date("2026-11-14T00:00:00.000Z");
const analyzers: PackageHash = ["Microsoft.CodeAnalysis.CSharp/4.14.0", "568a6wcTiv=="];
const common: PackageHash = ["Microsoft.CodeAnalysis.Common/4.14.0", "PC3tuwZYnC=="];

test("an unavailable vulnerability service fails the audit while other warnings do not", () => {
  const unavailable =
    "/src/TypeModeling.csproj : warning NU1900: Error occurred while getting package vulnerability data: Unable to load the service index for source https://api.nuget.org/v3/index.json.";
  const output = [
    unavailable,
    "/src/TypeModeling.csproj : warning NU1701: Package restored using another framework",
    unavailable,
    "Program.cs(1,1): error CS0029: Cannot convert",
  ].join("\n");
  expect(auditFindings(output)).toEqual([unavailable]);
});

test.each([
  "warning NU1901",
  "warning NU1902",
  "warning NU1903",
  "warning NU1904",
  "error NU1904",
  "warning NU1905",
])("%s is an audit finding", (severity) => {
  const line = `/src/Analyzers.csproj : ${severity}: Package 'Example' 1.0.0 has a known vulnerability`;
  expect(auditFindings(`Restored\n${line}\n`)).toEqual([line]);
});

test.each([
  [
    "userinfo",
    "https://reader:s3cret@feed.example/v3/index.json",
    "https://feed.example/v3/index.json",
  ],
  [
    "query string",
    "https://feed.example/v3/index.json?sig=s3cret&se=2026",
    "https://feed.example/v3/index.json?<redacted>",
  ],
  [
    "fragment",
    "https://feed.example/v3/index.json#access_token=s3cret",
    "https://feed.example/v3/index.json?<redacted>",
  ],
  [
    "userinfo and query string",
    "https://reader:s3cret@feed.example/v3/index.json?sig=s3cret",
    "https://feed.example/v3/index.json?<redacted>",
  ],
])("a feed URL's %s is never repeated in a finding or in echoed output", (_name, url, expected) => {
  const line = `/src/TypeModeling.csproj : warning NU1900: Unable to load the service index for source ${url}.`;
  const [finding] = auditFindings(line);
  expect(finding).toContain(expected);
  expect(finding).not.toContain("s3cret");
  expect(redactCredentials(`Restore failed for ${url}`)).toBe(`Restore failed for ${expected}`);
});

test("restored packages exclude projects and refuse a package without a content hash", () => {
  expect(
    restoredPackages({
      libraries: {
        [analyzers[0]]: { type: "package", sha512: analyzers[1] },
        "TypeModeling/1.0.0": { type: "project" },
      },
    }),
  ).toEqual([analyzers]);
  expect(() => restoredPackages({ libraries: { "Broken/1.0.0": { type: "package" } } })).toThrow(
    "Broken/1.0.0",
  );
});

test("a receipt records the audit instant and the same sorted packages for any restore order", () => {
  const text = serializeReceipt([common, analyzers, analyzers], instant);
  expect(text).toBe(serializeReceipt([analyzers, common], instant));
  expect(parseReceipt(text)).toEqual({
    auditedAt: "2026-11-14T00:00:00.000Z",
    packages: new Map([analyzers, common]),
  });
});

test.each([
  ["a file that is not JSON", "not json"],
  ["another document", JSON.stringify({ packages: { "A/1": "hash" } })],
  [
    "a receipt without packages",
    serializeReceipt([analyzers], instant).replace(/"packages": \{[^}]*\}/, '"packages": {}'),
  ],
  [
    "a receipt without a package hash",
    serializeReceipt([analyzers], instant).replace(analyzers[1], ""),
  ],
  [
    "a receipt without an audit instant",
    serializeReceipt([analyzers], instant).replace("2026-11-14T00:00:00.000Z", "yesterday"),
  ],
])("%s is not a package audit receipt", (_name, text) => {
  expect(parseReceipt(text)).toBeUndefined();
});

test("an audit that covers no package or sees one package under two hashes has no receipt", () => {
  expect(() => serializeReceipt([], instant)).toThrow("covers no package");
  expect(() => serializeReceipt([analyzers, [analyzers[0], "other=="]], instant)).toThrow(
    analyzers[0],
  );
});

test("restored packages are covered only by the same archive in the audit", () => {
  const audited = new Map([analyzers, common]);
  expect(unauditedPackages([common, analyzers, common], audited)).toEqual([]);
  expect(unauditedPackages([analyzers], new Map([common]))).toEqual([analyzers[0]]);
  expect(unauditedPackages([[analyzers[0], "other=="], common], audited)).toEqual([analyzers[0]]);
  expect(
    unauditedPackages(
      [
        ["Z/1.0.0", "z"],
        ["A/1.0.0", "a"],
        ["Z/1.0.0", "z"],
      ],
      audited,
    ),
  ).toEqual(["A/1.0.0", "Z/1.0.0"]);
});

test("restore settings that audit every package leave nothing to report", () => {
  expect(auditSettingsProblems("TypeModeling", { project: { restore: auditingRestore } })).toEqual(
    [],
  );
});

const settings = (audit: object): Restore => ({
  ...auditingRestore,
  restoreAuditProperties: { ...auditingRestore.restoreAuditProperties, ...audit },
});

test.each<[string, Restore, string]>([
  ["a disabled audit", settings({ enableAudit: "false" }), "the audit is disabled"],
  ["a raised level", settings({ auditLevel: "high" }), "the audit level is high, not low"],
  ["direct-only mode", settings({ auditMode: "direct" }), "the audit mode is direct, not all"],
  [
    "suppressed advisories",
    settings({ suppressedAdvisories: { "https://github.com/advisories/GHSA-0000": null } }),
    "advisories are suppressed",
  ],
  [
    "a silenced unavailable-data warning",
    { ...auditingRestore, warningProperties: { noWarn: ["nu1900"] } },
    "audit diagnostics are silenced: NU1900",
  ],
])("%s turns the audit into a no-op and is reported", (_name, restore, problem) => {
  expect(auditSettingsProblems("TypeModeling", { project: { restore } })).toEqual([
    `TypeModeling: ${problem}`,
  ]);
});

test("a package reference that silences an audit diagnostic is reported", () => {
  const assets: AssetsDocument = {
    project: {
      restore: auditingRestore,
      frameworks: { "netstandard2.0": { dependencies: { Example: { noWarn: ["NU1903"] } } } },
    },
  };
  expect(auditSettingsProblems("Analyzers", assets)).toEqual([
    "Analyzers: audit diagnostics are silenced: NU1903",
  ]);
});

test("a long report keeps its first lines and counts the rest", () => {
  expect(bounded(["a", "b", "c"], 2)).toBe("a\nb\n[1 more omitted]");
  expect(bounded(["a", "b"], 2)).toBe("a\nb");
});
