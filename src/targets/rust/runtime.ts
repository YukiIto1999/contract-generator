import { checkSupport } from "./runtime-checks.js";
import { jsonSupport } from "./runtime-json.js";
import { numericSupport } from "./runtime-numeric.js";
import { stateSupport } from "./runtime-state.js";
import type { Support } from "./support.js";
import { temporalSupport } from "./runtime-temporal.js";

export { typesPreamble } from "./runtime-preamble.js";

/** Private codec helpers retained only while generated declarations reach them */
export const typesSupport: readonly Support[] = [
  ...jsonSupport,
  ...numericSupport,
  ...stateSupport,
  ...checkSupport,
  ...temporalSupport,
];
