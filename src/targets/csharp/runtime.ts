import { runtimeNumbers } from "./runtime-numbers.js";
import { runtimeTemporal } from "./runtime-temporal.js";
import { runtimeValues } from "./runtime-values.js";
import { runtimeWire } from "./runtime-wire.js";

/** Pure generated support without HTTP or effect dependencies */
export const runtime: string = [runtimeValues, runtimeWire, runtimeNumbers, runtimeTemporal].join(
  "\n",
);
