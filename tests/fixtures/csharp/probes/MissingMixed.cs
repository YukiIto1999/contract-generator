using Exhaustiveness;

/// <summary>Consumer missing the numeric enumeration kind</summary>
internal static class MissingMixed
{
    /// <summary>Incomplete public enumeration match</summary>
    /// <param name="value">Public mixed enumeration</param>
    /// <returns>Text label</returns>
    public static string Read(Mixed value) => value switch { Mixed.Text => "text" };
}
