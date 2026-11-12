/** Exact numeric token comparison and integer conversion without binary64 */
export const runtimeNumbers = String.raw`
/// <summary>Standard JSON codec primitives</summary>
internal static partial class Wire
{
    /// <summary>JSON numeric grammar</summary>
    internal static readonly Regex NumberPattern = new(@"\A-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\z", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    /// <summary>Arbitrary precision decimal comparison</summary>
    /// <param name="left">Validated numeric token</param>
    /// <param name="right">Validated numeric token</param>
    /// <returns>Numeric ordering</returns>
    internal static int Compare(string left, string right)
    {
        var a = Parts(left); var b = Parts(right);
        if (a.Sign != b.Sign) return a.Sign.CompareTo(b.Sign);
        if (a.Sign == 0) return 0;
        int order = a.Magnitude.CompareTo(b.Magnitude);
        if (order == 0)
        {
            int length = Math.Max(a.Digits.Length, b.Digits.Length);
            for (int i = 0; i < length && order == 0; i++)
                order = (i < a.Digits.Length ? a.Digits[i] : '0').CompareTo(i < b.Digits.Length ? b.Digits[i] : '0');
        }
        return order * a.Sign;
    }
    /// <summary>Exact numeric comparison representation</summary>
    /// <param name="text">Validated numeric token</param>
    /// <returns>Sign, significant digits and decimal magnitude</returns>
    private static (int Sign, string Digits, BigInteger Magnitude) Parts(string text)
    {
        int start = text[0] == '-' ? 1 : 0;
        int e = text.IndexOfAny(['e', 'E']);
        string mantissa = e < 0 ? text[start..] : text[start..e];
        BigInteger exponent = e < 0 ? BigInteger.Zero : BigInteger.Parse(text.AsSpan(e + 1), CultureInfo.InvariantCulture);
        int point = mantissa.IndexOf('.');
        if (point >= 0) exponent -= mantissa.Length - point - 1;
        string digits = mantissa.Replace(".", "", StringComparison.Ordinal).TrimStart('0');
        if (digits.Length == 0) return (0, "", BigInteger.Zero);
        return (start == 0 ? 1 : -1, digits, exponent + digits.Length);
    }
    /// <summary>Exact integer-domain membership without exponent expansion</summary>
    /// <param name="text">Validated numeric token</param>
    /// <returns>Whether the token denotes an integral value</returns>
    internal static bool IsInteger(string text)
    {
        var parts = Parts(text);
        if (parts.Sign == 0 || parts.Magnitude >= parts.Digits.Length) return true;
        BigInteger fraction = parts.Digits.Length - parts.Magnitude;
        if (fraction > parts.Digits.Length) return false;
        int count = (int)fraction;
        return parts.Digits.AsSpan(parts.Digits.Length - count).IndexOfAnyExcept('0') < 0;
    }
    /// <summary>Exact standard integer conversion including integral exponents</summary>
    /// <param name="text">Candidate JSON numeric token</param>
    /// <param name="value">Exact integer value</param>
    /// <returns>Whether the token is an integer</returns>
    internal static bool TryInteger(string text, out BigInteger value)
    {
        value = BigInteger.Zero;
        if (!NumberPattern.IsMatch(text) || !IsInteger(text)) return false;
        var parts = Parts(text);
        if (parts.Sign == 0) return true;
        BigInteger exponent = parts.Magnitude - parts.Digits.Length;
        string digits = exponent.Sign < 0 ? parts.Digits[..(parts.Digits.Length + (int)exponent)] : parts.Digits;
        value = BigInteger.Parse(digits, CultureInfo.InvariantCulture) * parts.Sign;
        if (exponent.Sign > 0) value *= BigInteger.Pow(10, checked((int)exponent));
        return true;
    }
}
`;
