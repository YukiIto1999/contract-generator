using Sample;

/// <summary>Alias field compatibility with its original nominal role</summary>
internal static class AliasAccepted
{
    /// <summary>Alias assignment across generated field references</summary>
    /// <param name="envelope">Immutable generated contract</param>
    /// <returns>The same RequestId role</returns>
    internal static RequestId Read(Envelope envelope) => envelope.CorrelationId;
}
