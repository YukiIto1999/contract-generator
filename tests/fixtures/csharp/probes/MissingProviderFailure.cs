using Exhaustiveness.Provider;

/// <summary>Consumer missing the chosen operation failure</summary>
internal static class MissingProviderFailure
{
    /// <summary>Incomplete public provider failure match</summary>
    /// <param name="value">Provider dispatch failure</param>
    /// <returns>Unknown operation label</returns>
    public static string Read(ProviderFailure value) => value switch { ProviderFailure.UnknownOperation => "unknown" };
}
