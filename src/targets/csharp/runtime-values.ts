/** Public result and presence vocabulary of the pure types assembly */
export const runtimeValues = String.raw`
/// <summary>Explicit property presence independent of nullability</summary>
/// <typeparam name="T">Present value representation</typeparam>
public readonly struct Presence<T>
{
    /// <summary>Present storage</summary>
    private readonly T _value;
    /// <summary>Explicit present state</summary>
    /// <value>Whether the property was supplied</value>
    public bool IsPresent { get; }
    /// <summary>Present value access</summary>
    /// <value>Value including a permitted null</value>
    /// <exception cref="InvalidOperationException">Access to an absent property</exception>
    public T Value => IsPresent ? _value : throw new InvalidOperationException("Absent property");
    /// <summary>Present property completion</summary>
    /// <param name="value">Supplied value</param>
    private Presence(T value) { _value = value; IsPresent = true; }
    /// <summary>Explicit property inclusion</summary>
    /// <param name="value">Supplied value</param>
    /// <returns>Present property</returns>
    public static Presence<T> Present(T value) => new(value);
}

/// <summary>Positioned normal contract violation</summary>
/// <param name="Path">RFC 6901 pointer of the offending value</param>
/// <param name="Rule">Semantic rule identifier that the value broke</param>
public sealed record Violation(string Path, string Rule);
/// <summary>Unknown property observation without its value</summary>
/// <param name="Path">Pointer of the containing object</param>
/// <param name="Key">Unknown wire property name</param>
public sealed record UnknownProperty(string Path, string Key);
/// <summary>Accepted immutable value with compatibility observations</summary>
/// <typeparam name="T">Contract representation</typeparam>
/// <param name="Value">Completed value</param>
/// <param name="Diagnostics">Unknown property observations made while accepting the value</param>
public sealed record Accepted<T>(T Value, ImmutableArray<UnknownProperty> Diagnostics);
/// <summary>Rejected input without a partially completed value</summary>
/// <param name="Violations">Positioned violations</param>
/// <param name="Diagnostics">Unknown property observations independent of the violations</param>
public sealed record ContractFailure(ImmutableArray<Violation> Violations, ImmutableArray<UnknownProperty> Diagnostics);

/// <summary>Exact JSON numeric token independent of machine decimal limits</summary>
public readonly struct ExactDecimal
{
    /// <summary>Validated source token</summary>
    private readonly string? _text;
    /// <summary>Exact token access</summary>
    /// <value>Original decimal spelling</value>
    /// <exception cref="InvalidOperationException">Access to an uninitialized decimal</exception>
    public string Text => _text ?? throw new InvalidOperationException("Uninitialized exact decimal");
    /// <summary>Construction state</summary>
    /// <value>Whether a validated token is held</value>
    public bool IsInitialized => _text is not null;
    /// <summary>Validated decimal completion</summary>
    /// <param name="text">Validated token</param>
    private ExactDecimal(string text) { _text = text; }
    /// <summary>Exact decimal construction</summary>
    /// <param name="text">Candidate JSON numeric token</param>
    /// <returns>Decimal or a format violation</returns>
    public static Result<Accepted<ExactDecimal>, ContractFailure> Create(string text)
    {
        var c = new ReadContext();
        if (text is null || !Wire.NumberPattern.IsMatch(text)) c.Add("", "format");
        return c.Finish(c.IsValid ? new ExactDecimal(text!) : default);
    }
    /// <summary>Validated token completion shared by every decoder</summary>
    /// <param name="text">Validated token</param>
    /// <returns>Completed exact decimal</returns>
    internal static ExactDecimal Complete(string text) => new(text);
}

/// <summary>Per-boundary validation accumulation</summary>
internal sealed class ReadContext
{
    /// <summary>Known property violations</summary>
    private List<Violation>? _violations;
    /// <summary>Unknown property observations</summary>
    private List<UnknownProperty>? _diagnostics;
    /// <summary>Completion permission</summary>
    /// <value>Whether no violation was recorded</value>
    internal bool IsValid => _violations is null;
    /// <summary>Violation accumulation</summary>
    /// <param name="path">Pointer of the offending value</param>
    /// <param name="rule">Semantic rule that the value broke</param>
    internal void Add(string path, string rule) => (_violations ??= new()).Add(new(path, rule));
    /// <summary>Unknown property accumulation</summary>
    /// <param name="path">Pointer of the containing object</param>
    /// <param name="key">Unknown wire name</param>
    internal void Unknown(string path, string key) => (_diagnostics ??= new()).Add(new(path, key));
    /// <summary>Independent value-validation checkpoint</summary>
    /// <value>Number of violations recorded so far</value>
    internal int ViolationCount => _violations?.Count ?? 0;
    /// <summary>Rejected boundary snapshot</summary>
    /// <value>Violations and observations after rejection</value>
    internal ContractFailure Failure => new(_violations!.ToImmutableArray(), _diagnostics?.ToImmutableArray() ?? ImmutableArray<UnknownProperty>.Empty);
    /// <summary>Atomic boundary completion</summary>
    /// <typeparam name="T">Completed representation</typeparam>
    /// <param name="value">Candidate that rejection hides</param>
    /// <returns>Accepted value or violations</returns>
    internal Result<Accepted<T>, ContractFailure> Finish<T>(T value) => IsValid
        ? new Result<Accepted<T>, ContractFailure>.Succeeded(new(value, _diagnostics?.ToImmutableArray() ?? ImmutableArray<UnknownProperty>.Empty))
        : new Result<Accepted<T>, ContractFailure>.Failed(Failure);
}

/// <summary>Reflection-free standard JSON parser metadata</summary>
[System.Text.Json.Serialization.JsonSerializable(typeof(JsonElement))]
internal partial class ContractJsonContext : System.Text.Json.Serialization.JsonSerializerContext { }
`;
