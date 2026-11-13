import { expect, test } from "vite-plus/test";
import { restoreAuditProblems } from "./restore-counts.ts";

/** Result file in the shape that MSBuild's `-getProperty` with `-getResultOutputFile` writes, with NuGet's documented property names */
const result = (projects: string, audited: string, skipped: string) => `{
  "Properties": {
    "RestoreProjectCount": "${projects}",
    "RestoreProjectsAuditedCount": "${audited}",
    "RestoreSkippedCount": "${skipped}"
  }
}`;

test("a fresh restore that audited every project of its graph proves the audit", () => {
  expect(restoreAuditProblems(result("4", "4", "0"), 4)).toEqual([]);
});

test.each([
  [
    "a project graph that an enabled audit never reached, as when no audit source serves vulnerability data",
    result("4", "0", "0"),
    4,
    ["0 of 4 projects were audited"],
  ],
  ["one unaudited project", result("4", "3", "0"), 4, ["3 of 4 projects were audited"]],
  [
    "projects already up to date, whose audit did not run",
    result("4", "2", "2"),
    4,
    ["2 projects were up to date and skipped their audit", "2 of 4 projects were audited"],
  ],
  [
    "a graph larger than the projects that wrote assets",
    result("4", "4", "0"),
    3,
    ["4 projects were counted but 3 wrote restore assets"],
  ],
  ["a restore of no project", result("0", "0", "0"), 0, ["the restore covered no project"]],
])("%s is not proof of an audit", (_name, resultJson, assets, expected) => {
  expect(restoreAuditProblems(resultJson, assets)).toEqual(expected);
});

test.each([
  ["no result file", undefined, "wrote no result file"],
  ["a result file that is not JSON", "restore failed", "not JSON"],
  [
    "counts that NuGet did not report, as in static graph restore",
    result("", "", ""),
    "no audit counts",
  ],
  ["a result without properties", "{}", "no audit counts"],
  ["a count that is not a number", result("four", "4", "0"), "no audit counts"],
  ["a negative count", result("4", "4", "-1"), "no audit counts"],
])("%s proves nothing", (_name, resultJson, reason) => {
  expect(restoreAuditProblems(resultJson, 4)).toEqual([expect.stringContaining(reason)]);
});
