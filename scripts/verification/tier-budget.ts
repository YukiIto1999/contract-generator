/** Public verification entry, named as the npm script that starts it */
export type Tier = "verify" | "verify:push" | "test";

/** Key of each entry's ceiling in `tiergate.json`, which the environment contract names after the stage
 * (`verify-push`) and not after the npm script (`verify:push`); the full test run shares the push ceiling */
const stageKeys: Readonly<Record<Tier, string>> = {
  verify: "verify",
  "verify:push": "verify-push",
  test: "verify-push",
};

/** Resource ceiling that `tiergate.json` declares for an entry
 * @param declaration - Text of `tiergate.json`
 * @param tier - Public entry
 * @returns Whole-run seconds
 * @throws {@link Error} Missing or non-finite ceiling
 */
export function tierSeconds(declaration: string, tier: Tier): number {
  const budget = JSON.parse(declaration) as Record<string, { seconds?: number }>;
  const key = stageKeys[tier];
  const seconds = budget[key]?.seconds ?? Number.NaN;
  if (!Number.isFinite(seconds) || !(seconds > 0))
    throw new Error(`Missing finite ${key} seconds resource ceiling in tiergate.json`);
  return seconds;
}
