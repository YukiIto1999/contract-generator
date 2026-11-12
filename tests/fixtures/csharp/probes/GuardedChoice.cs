using Exhaustiveness;

/// <summary>Consumer whose guarded arm omits valid numeric values</summary>
internal static class GuardedChoice
{
    /// <summary>Partial payload coverage despite both variant names</summary>
    /// <param name="value">Public choice</param>
    /// <returns>Matched variant label</returns>
    public static string Read(Choice value) => value switch
    {
        Choice.Text => "text",
        Choice.Number number when number.Value.Value > 0 => "positive",
    };
}
