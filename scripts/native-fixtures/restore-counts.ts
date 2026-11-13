/** Properties that the NuGet restore task reports: projects in the graph, projects whose audit ran, and projects already up to date */
export const restoreCountProperties = [
  "RestoreProjectCount",
  "RestoreProjectsAuditedCount",
  "RestoreSkippedCount",
] as const;

/** Result file of `-getProperty` with `-getResultOutputFile`, whose shape MSBuild guarantees */
interface ResultDocument {
  /** Property values by name; a property that was never set is an empty string */
  readonly Properties?: Readonly<Record<string, unknown>>;
}

/** Reasons that a restore does not prove it audited every project of its graph
 *
 * NuGet reports `RestoreProjectCount` (projects in the graph), `RestoreProjectsAuditedCount` (projects whose audit ran) and `RestoreSkippedCount` (projects already up to date, whose restore and audit did not run).
 * A fresh artifacts directory forces every project of the graph through a real restore, so the audit is proven only when all projects were audited and none was skipped.
 * @param resultJson - Content of the result file that MSBuild wrote for {@link restoreCountProperties}, or nothing when it wrote none
 * @param assetsWritten - Number of projects that wrote `project.assets.json` below the restore's artifacts directory
 * @returns One line per violated condition; none when every restored project was audited
 */
export function restoreAuditProblems(
  resultJson: string | undefined,
  assetsWritten: number,
): string[] {
  if (resultJson === undefined)
    return ["the restore wrote no result file, so NuGet reported no audit counts"];
  let document: ResultDocument | null;
  try {
    document = JSON.parse(resultJson) as ResultDocument | null;
  } catch {
    return ["the restore result file is not JSON, so NuGet reported no audit counts"];
  }
  const [projects, audited, skipped] = restoreCountProperties.map((name) => {
    const value = document?.Properties?.[name];
    return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined;
  });
  if (projects === undefined || audited === undefined || skipped === undefined)
    return ["NuGet reported no audit counts, as static graph restore does not"];
  const problems: string[] = [];
  if (projects === 0) problems.push("the restore covered no project");
  if (skipped !== 0) problems.push(`${skipped} projects were up to date and skipped their audit`);
  if (audited !== projects) problems.push(`${audited} of ${projects} projects were audited`);
  if (projects !== assetsWritten)
    problems.push(`${projects} projects were counted but ${assetsWritten} wrote restore assets`);
  return problems;
}
