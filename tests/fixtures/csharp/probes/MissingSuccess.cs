using Exhaustiveness;

/// <summary>Consumer missing the completed success result</summary>
internal static class MissingSuccess
{
    /// <summary>Incomplete public success match</summary>
    /// <param name="value">Successful operation result</param>
    /// <returns>Created result label</returns>
    public static string Read(ChooseSuccess value) => value switch { ChooseSuccess.Created => "created" };
}
