/// <summary>Consumer incompletely matching an open discriminator string</summary>
internal static class OpenExpression
{
    /// <summary>Open string match outside the closed-hierarchy suppressor</summary>
    /// <param name="tag">Untrusted discriminator</param>
    /// <returns>Matched tag label</returns>
    public static string Read(string tag) => tag switch { "text" => "text", "number" => "number" };
}
