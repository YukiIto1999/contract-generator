using EffectSystem.Domain;

/// <summary>Consumer operation that omits effect construction</summary>
public static class UnconstructedEffect
{
    /// <summary>Invalid effect with no execution function</summary>
    /// <returns>Unconstructed effect rejected by the dependency analyzer</returns>
    public static Effect<NoRequirements, string, int> Operation() => default;
}
