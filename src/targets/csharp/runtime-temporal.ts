/** Calendar, duration and byte-alphabet validation without host date-time types */
export const runtimeTemporal = String.raw`
/// <summary>Standard JSON codec primitives</summary>
internal static partial class Wire
{
    /// <summary>Date-time duration form and the unsigned stand-alone week form of RFC 3339 appendix A</summary>
    private static readonly Regex DurationPattern = new(@"\A(?:P[0-9]+W|-?P(?:[0-9]+Y)?(?:[0-9]+M)?(?:[0-9]+D)?(?:T(?:[0-9]+H)?(?:[0-9]+M)?(?:[0-9]+(?:\.[0-9]+)?S)?)?)\z", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    /// <summary>Exact offset date-time grammar</summary>
    private static readonly Regex OffsetPattern = new(@"\A([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})\z", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    /// <summary>Duration spelling validation including the week form</summary>
    /// <param name="text">Candidate duration spelling</param>
    /// <returns>Whether the spelling names at least one component</returns>
    internal static bool DurationText(string text) => text is not "P" and not "-P" && !text.EndsWith('T') && DurationPattern.IsMatch(text);
    /// <summary>Exact calendar and offset validation including year zero and leap seconds</summary>
    /// <param name="text">Candidate date-time spelling</param>
    /// <param name="utc">Whether only a zero offset is valid</param>
    /// <returns>Grammar and calendar validity</returns>
    internal static bool DateTimeText(string text, bool utc)
    {
        var m = OffsetPattern.Match(text);
        if (!m.Success) return false;
        int year = int.Parse(m.Groups[1].ValueSpan, CultureInfo.InvariantCulture);
        int month = int.Parse(m.Groups[2].ValueSpan, CultureInfo.InvariantCulture);
        int day = int.Parse(m.Groups[3].ValueSpan, CultureInfo.InvariantCulture);
        int hour = int.Parse(m.Groups[4].ValueSpan, CultureInfo.InvariantCulture);
        int minute = int.Parse(m.Groups[5].ValueSpan, CultureInfo.InvariantCulture);
        int second = int.Parse(m.Groups[6].ValueSpan, CultureInfo.InvariantCulture);
        ReadOnlySpan<char> offset = m.Groups[8].ValueSpan;
        if (month < 1 || month > 12 || day < 1 || day > MonthDays(year, month) || hour > 23 || minute > 59 || second > 60) return false;
        if (offset.Length > 1 && (int.Parse(offset.Slice(1, 2), CultureInfo.InvariantCulture) > 23 || int.Parse(offset.Slice(4, 2), CultureInfo.InvariantCulture) > 59)) return false;
        if (utc && offset is not "Z" and not "z" and not "+00:00" and not "-00:00") return false;
        if (second != 60) return true;
        int offsetMinutes = offset.Length == 1 ? 0 : (int.Parse(offset.Slice(1, 2), CultureInfo.InvariantCulture) * 60 + int.Parse(offset.Slice(4, 2), CultureInfo.InvariantCulture)) * (offset[0] == '-' ? -1 : 1);
        int total = hour * 60 + minute - offsetMinutes;
        if ((total + 1440) % 1440 != 1439) return false;
        if (total < 0)
        {
            day--;
            if (day == 0) { month--; if (month == 0) { month = 12; year--; } day = MonthDays(year, month); }
        }
        else if (total >= 1440)
        {
            day++;
            if (day > MonthDays(year, month)) { day = 1; month++; if (month == 13) month = 1; }
        }
        return month == 6 && day == 30 || month == 12 && day == 31;
    }
    /// <summary>Proleptic Gregorian month cardinality including year zero</summary>
    /// <param name="year">Gregorian year</param>
    /// <param name="month">Validated one-based month</param>
    /// <returns>Calendar day count</returns>
    private static int MonthDays(int year, int month) => month switch {
        2 => year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) ? 29 : 28,
        4 or 6 or 9 or 11 => 30,
        _ => 31
    };
    /// <summary>Nonthrowing standard base64 decoding</summary>
    /// <param name="text">Candidate encoded bytes</param>
    /// <param name="url">Whether the URL-safe alphabet without padding applies</param>
    /// <param name="bytes">Owned immutable bytes</param>
    /// <returns>Whether the text is valid in the selected alphabet</returns>
    internal static bool Bytes(string text, bool url, out ImmutableArray<byte> bytes)
    {
        bytes = default;
        int length;
        if (url)
        {
            if (!Regex.IsMatch(text, @"\A[A-Za-z0-9_-]*\z", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking) || text.Length % 4 == 1) return false;
            length = text.Length / 4 * 3 + (text.Length % 4 == 2 ? 1 : text.Length % 4 == 3 ? 2 : 0);
        }
        else
        {
            if (!Regex.IsMatch(text, @"\A(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\z", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking)) return false;
            length = text.Length / 4 * 3 - (text.EndsWith("==", StringComparison.Ordinal) ? 2 : text.EndsWith('=') ? 1 : 0);
        }
        byte[] buffer = length == 0 ? Array.Empty<byte>() : new byte[length];
        bool decoded = url ? System.Buffers.Text.Base64Url.TryDecodeFromChars(text, buffer, out int writtenUrl) && writtenUrl == length : Convert.TryFromBase64String(text, buffer, out int written) && written == length;
        if (!decoded) return false;
        bytes = System.Runtime.InteropServices.ImmutableCollectionsMarshal.AsImmutableArray(buffer);
        return true;
    }
}
`;
