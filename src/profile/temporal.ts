/** Date-time form of a duration: optional sign, calendar designators then time designators, at least one component */
const dateTimeDuration =
  /^-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;

/** Week form of a duration from RFC 3339 appendix A, which admits no other component */
const weekDuration = /^P\d+W$/;

/** Wall-clock time of day with optional fractional seconds and no leap second */
const timeOfDay = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/;

/** RFC 3339 date and time with a mandatory offset, capturing date parts, time parts and the offset sign and parts */
const offsetDateTimeText =
  /^((\d{4})-(\d{2})-(\d{2}))[Tt]([01]\d|2[0-3]):([0-5]\d):([0-5]\d|60)(?:\.\d+)?(?:[Zz]|([+-])([01]\d|2[0-3]):([0-5]\d))$/;

/** Days in each calendar month of a common year */
const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Duration in the RFC 3339 date-time form or the week form
 * @param text - Candidate lexical duration
 * @returns Membership in the accepted duration grammar
 */
export function validDuration(text: string): boolean {
  return dateTimeDuration.test(text) || weekDuration.test(text);
}

/**
 * Wall-clock time without date or offset
 * @param text - Candidate lexical time
 * @returns Membership in the accepted time grammar
 */
export function validPlainTime(text: string): boolean {
  return timeOfDay.test(text);
}

/**
 * Proleptic Gregorian date validation including year zero
 * @param text - Four-digit-year calendar date
 * @returns Calendar membership without host date normalization
 */
export function validDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const length = month === 2 && isLeapYear(year) ? 29 : (monthLengths[month - 1] ?? 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= length;
}

/**
 * Gregorian leap-year rule
 * @param year - Full Gregorian year
 * @returns Whether February of the year has 29 days
 */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Offset datetime validation retaining fractional seconds and UTC leap-second positions
 * @param text - RFC 3339 calendar and time spelling
 * @param utc - Requirement for a zero UTC offset
 * @returns Lexical domain membership without precision loss
 */
export function validDateTime(text: string, utc: boolean): boolean {
  const match = offsetDateTimeText.exec(text);
  if (!match || !validDate(match[1]!)) return false;
  const offset =
    match[8] === undefined
      ? 0
      : (Number(match[9]) * 60 + Number(match[10])) * (match[8] === "-" ? -1 : 1);
  if (utc && offset !== 0) return false;
  if (match[7] !== "60") return true;
  const year = Number(match[2]);
  const utcMinutes = Number(match[5]) * 60 + Number(match[6]) - offset;
  if (((utcMinutes % 1440) + 1440) % 1440 !== 1439) return false;
  const utcDay =
    civilDays(year, Number(match[3]), Number(match[4])) + Math.floor(utcMinutes / 1440);
  return [year - 1, year, year + 1].some(
    (candidate) =>
      utcDay === civilDays(candidate, 6, 30) || utcDay === civilDays(candidate, 12, 31),
  );
}

/**
 * Proleptic Gregorian day ordinal including year zero
 * @param year - Full Gregorian year
 * @param month - One-based calendar month
 * @param day - One-based calendar day
 * @returns Monotonic day ordinal for calendar arithmetic
 */
function civilDays(year: number, month: number, day: number): number {
  const shifted = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const within = shifted - era * 400;
  const ordinal = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146097 + within * 365 + Math.floor(within / 4) - Math.floor(within / 100) + ordinal;
}
