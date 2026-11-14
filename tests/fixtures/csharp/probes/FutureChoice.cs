using Exhaustiveness;

/// <summary>Consumer hiding a future closed variant behind a fallback</summary>
internal static class FutureChoice
{
    /// <summary>Match that would silently accept a newly added variant</summary>
    /// <param name="value">Public choice</param>
    /// <returns>Observed variant label</returns>
    public static string Read(Choice value) => value switch
    {
        Choice.Text => "text",
        _ => "other",
    };
}
