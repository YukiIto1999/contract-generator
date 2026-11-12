using Exhaustiveness;

/// <summary>Consumer missing the communication failure origin</summary>
internal static class MissingFailure
{
    /// <summary>Incomplete public operation failure match</summary>
    /// <param name="value">Expected operation failure</param>
    /// <returns>Failure origin</returns>
    public static string Read(ChooseFailure value) => value switch
    {
        ChooseFailure.InvalidInput => "input",
        ChooseFailure.Declared => "declared",
    };
}
