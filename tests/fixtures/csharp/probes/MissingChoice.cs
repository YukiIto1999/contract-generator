using Exhaustiveness;

/// <summary>Consumer missing the numeric union variant</summary>
internal static class MissingChoice
{
    /// <summary>Incomplete public union match</summary>
    /// <param name="value">Public choice</param>
    /// <returns>Text label</returns>
    public static string Read(Choice value) => value switch { Choice.Text => "text" };
}
