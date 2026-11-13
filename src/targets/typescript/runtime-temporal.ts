/** Calendar validation and exact Unix timestamp conversion without Date */
export const runtimeTemporalSource = String.raw`/** Temporal declaration kinds validated by calendar rules */
type TemporalKind = "offsetDateTime" | "utcDateTime" | "plainDate" | "plainTime" | "duration";

/** RFC 3339 appendix A durations: the date-time form or the week form alone */
const durationText = /^(?:P\d+W|-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?)$/;
/** Calendar date spelling */
const dateText = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Clock time spelling with optional fractional seconds */
const clockText = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
/** Instant spelling with date, time and offset */
const instantText = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([Zz]|[+-]\d{2}:\d{2})$/;
/** Earliest RFC 3339 calendar instant in epoch seconds */
const earliestUnix = new LosslessNumber("-62167219200");
/** Exclusive RFC 3339 calendar upper boundary in epoch seconds */
const latestUnix = new LosslessNumber("253402300800");

/**
 * Calendar validation retaining precision and source offset
 * @param value - Source spelling
 * @param kind - Declared temporal semantics
 * @returns Format acceptance
 */
function temporal(value: string, kind: TemporalKind): boolean {
  switch (kind) {
    case "duration": return durationText.test(value);
    case "plainDate": return validDate(value);
    case "plainTime": return validClock(value, 59);
    case "offsetDateTime": return validInstant(value, false);
    case "utcDateTime": return validInstant(value, true);
  }
}

/**
 * Gregorian date validation including year zero
 * @param text - Calendar date spelling
 * @returns Whether the date exists
 */
function validDate(text: string): boolean {
  const match = dateText.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leap ? 29 : 28) : month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
  return month >= 1 && month <= 12 && day >= 1 && day <= days;
}

/**
 * Clock time validation
 * @param text - Clock time spelling
 * @param maxSecond - Largest accepted second
 * @returns Whether the time exists
 */
function validClock(text: string, maxSecond: number): boolean {
  const match = clockText.exec(text);
  return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59 && Number(match[3]) <= maxSecond;
}

/**
 * Signed offset in minutes
 * @param text - Offset spelling
 * @returns Minutes east of UTC or absence for an impossible offset
 */
function offsetMinutes(text: string): number | undefined {
  if (text === "Z" || text === "z") return 0;
  const hours = Number(text.slice(1, 3));
  const minutes = Number(text.slice(4));
  if (hours > 23 || minutes > 59) return undefined;
  return (hours * 60 + minutes) * (text.startsWith("-") ? -1 : 1);
}

/**
 * Instant validation with offset and leap second rules
 * @param value - Instant spelling
 * @param zeroOffsetOnly - Rejection of every offset except zero
 * @returns Whether the instant exists
 */
function validInstant(value: string, zeroOffsetOnly: boolean): boolean {
  const match = instantText.exec(value);
  if (match === null) return false;
  const date = match[1]!;
  const clock = match[2]!;
  const offset = offsetMinutes(match[3]!);
  if (offset === undefined || (zeroOffsetOnly && offset !== 0)) return false;
  if (!validDate(date) || !validClock(clock, 60)) return false;
  return !clock.startsWith("60", 6) || leapSecondInstant(date, clock, offset);
}

/**
 * Leap second placement at the end of a UTC June or December day
 * @param date - Valid calendar date spelling
 * @param clock - Valid clock time spelling whose second is sixty
 * @param offset - Signed offset in minutes
 * @returns Whether the instant is the last UTC minute of June 30 or December 31
 */
function leapSecondInstant(date: string, clock: string, offset: number): boolean {
  const calendar = dateText.exec(date)!;
  const year = Number(calendar[1]);
  const month = Number(calendar[2]);
  const day = Number(calendar[3]);
  const shifted = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5)) - offset;
  if ((((shifted % 1440) + 1440) % 1440) !== 1439) return false;
  const utcDay = civilDays(year, month, day) + Math.floor(shifted / 1440);
  const utcYear = month === 1 && day === 1 && shifted < 0 ? year - 1 : year;
  return utcDay === civilDays(utcYear, 6, 30) || utcDay === civilDays(utcYear, 12, 31);
}

/**
 * Gregorian day index including year zero
 * @param year - Full Gregorian year
 * @param month - One-based month
 * @param day - One-based day
 * @returns Unix-relative day index
 */
function civilDays(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const within = y - era * 400;
  const ordinal = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146097 + within * 365 + Math.floor(within / 4) - Math.floor(within / 100) + ordinal - 719468;
}

/**
 * Exact UTC timestamp wire number without Date conversion
 * @param value - Validated source timestamp
 * @returns Exact epoch seconds
 */
function unixNumber(value: string): LosslessNumber {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value)!;
  const offset = match[9] === undefined ? 0 : (Number(match[10]) * 3600 + Number(match[11]) * 60) * (match[9] === "-" ? -1 : 1);
  const clock = Number(match[4]) * 3600 + Number(match[5]) * 60 + Number(match[6]) - offset;
  const seconds = BigInt(civilDays(Number(match[1]), Number(match[2]), Number(match[3]))) * 86400n + BigInt(clock);
  const fraction = match[7] ?? "";
  const coefficient = seconds * 10n ** BigInt(fraction.length) + BigInt(fraction || "0");
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString().padStart(fraction.length + 1, "0");
  const split = fraction.length === 0 ? digits : digits.slice(0, -fraction.length) + "." + digits.slice(-fraction.length);
  return new LosslessNumber((coefficient < 0n ? "-" : "") + split);
}

/**
 * Exact timestamp range without calendar expansion
 * @param text - Valid JSON number token
 * @returns RFC3339 year-range acceptance
 */
function unixRange(text: string): boolean {
  const candidate = new LosslessNumber(text);
  return compareLosslessNumber(candidate, earliestUnix) >= 0 && compareLosslessNumber(candidate, latestUnix) < 0;
}

/**
 * Whole epoch seconds and non-negative fraction digits of an exact timestamp
 * @param text - Valid JSON number token inside the calendar range
 * @returns Floor seconds with the fraction that follows them, or absence for an unrepresentable scale
 */
function epochParts(text: string): { readonly whole: bigint; readonly fraction: string } | undefined {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text)!;
  const scale = (match[3] ?? "").length - Number(match[4] ?? "0");
  if (!Number.isSafeInteger(scale)) return undefined;
  const places = Math.max(scale, 0);
  const digits = (match[2]! + (match[3] ?? "") + "0".repeat(Math.max(-scale, 0))).padStart(places + 1, "0");
  const fraction = places === 0 ? "" : digits.slice(-places);
  const magnitude = BigInt(places === 0 ? digits : digits.slice(0, -places));
  if (match[1] !== "-") return { whole: magnitude, fraction };
  if (!/[1-9]/.test(fraction)) return { whole: -magnitude, fraction };
  return { whole: -magnitude - 1n, fraction: (10n ** BigInt(places) - BigInt(fraction)).toString().padStart(places, "0") };
}

/**
 * Exact epoch seconds restoration into UTC calendar spelling
 * @param text - Valid JSON number token
 * @returns Full-precision UTC spelling or out-of-range absence
 */
function utcTimestamp(text: string): string | undefined {
  const parts = unixRange(text) ? epochParts(text) : undefined;
  if (parts === undefined) return undefined;
  const days = Number(parts.whole >= 0n ? parts.whole / 86400n : (parts.whole - 86399n) / 86400n);
  const seconds = Number(parts.whole - BigInt(days) * 86400n);
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex + (monthIndex < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  const date = [String(year).padStart(4, "0"), String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
  const time = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
  return date + "T" + time + (parts.fraction ? "." + parts.fraction : "") + "Z";
}

/**
 * Unix seconds acceptance as a calendar timestamp or an exact preserved token
 * @param value - Candidate wire number
 * @param path - Candidate location
 * @param state - Current call
 * @param preserved - Retention of the exact numeric token instead of the calendar spelling
 * @returns Accepted spelling or the invalid sentinel
 */
function readUnixSeconds(value: unknown, path: Path, state: State, preserved: boolean): string | undefined {
  const token = jsonNumberText(value);
  if (token === undefined) return invalid(state, path, "type");
  if (preserved) return unixRange(token) ? token : invalid(state, path, "format");
  return utcTimestamp(token) ?? invalid(state, path, "format");
}

/**
 * UTC instant binding representation
 * @param value - Completed calendar spelling or preserved Unix token
 * @param selected - Selected binding encoding
 * @param preserved - Retention of exact Unix tokens
 * @returns Exact Unix seconds for the Unix encoding, otherwise the calendar spelling
 */
function writeInstant(value: string, selected: string, preserved: boolean): unknown {
  const token = preserved && numberToken.test(value);
  if (selected === "unixTimestamp") return token ? new LosslessNumber(value) : unixNumber(value);
  return token ? utcTimestamp(value)! : value;
}
`;
