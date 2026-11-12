using Exhaustiveness;

/// <summary>Consumer using a switch statement for a closed type</summary>
internal static class ClosedStatement
{
    /// <summary>Statement match without compiler exhaustiveness</summary>
    /// <param name="value">Public choice</param>
    /// <returns>Matched variant label</returns>
    public static string Read(Choice value)
    {
        switch (value)
        {
            case Choice.Text: return "text";
            case Choice.Number: return "number";
        }
        throw new InvalidOperationException("Unknown variant");
    }
}
