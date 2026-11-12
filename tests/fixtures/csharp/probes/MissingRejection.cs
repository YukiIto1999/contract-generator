using Exhaustiveness;

/// <summary>Consumer missing the missing-resource rejection</summary>
internal static class MissingRejection
{
    /// <summary>Incomplete public rejection match</summary>
    /// <param name="value">Declared rejection</param>
    /// <returns>Refused result label</returns>
    public static string Read(ChooseRejection value) => value switch { ChooseRejection.Refused => "refused" };
}
