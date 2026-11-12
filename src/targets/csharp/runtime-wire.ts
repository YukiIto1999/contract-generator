/** Standard JSON boundary primitives shared by every generated codec */
export const runtimeWire = String.raw`
/// <summary>Standard JSON codec primitives</summary>
internal static partial class Wire
{
    /// <summary>RFC 6901 pointer extension</summary>
    /// <param name="path">Parent pointer</param>
    /// <param name="key">Unescaped segment</param>
    /// <returns>Extended pointer</returns>
    internal static string At(string path, string key) => path + "/" + key.Replace("~", "~0", StringComparison.Ordinal).Replace("/", "~1", StringComparison.Ordinal);
    /// <summary>Nonthrowing string extraction because unpaired surrogate escapes are invalid text rather than defects</summary>
    /// <param name="element">JSON string element</param>
    /// <param name="c">Violation accumulator of the current boundary</param>
    /// <param name="path">Pointer of the string</param>
    /// <param name="value">Decoded UTF-16 text</param>
    /// <returns>Whether the text is valid</returns>
    internal static bool TryString(JsonElement element, ReadContext c, string path, out string value)
    {
        try { value = element.GetString()!; return true; }
        catch (InvalidOperationException) { value = ""; c.Add(path, "format"); return false; }
    }
    /// <summary>Nonthrowing property-name extraction because unpaired surrogate escapes are invalid text rather than defects</summary>
    /// <param name="property">JSON object member</param>
    /// <param name="c">Violation accumulator of the current boundary</param>
    /// <param name="path">Pointer of the containing object</param>
    /// <param name="name">Decoded UTF-16 member name</param>
    /// <returns>Whether the name is valid</returns>
    internal static bool TryName(JsonProperty property, ReadContext c, string path, out string name)
    {
        try { name = property.Name; return true; }
        catch (InvalidOperationException) { name = ""; c.Add(path, "format"); return false; }
    }
    /// <summary>Public standard-parser boundary with a fresh accumulator</summary>
    /// <typeparam name="T">Contract representation</typeparam>
    /// <param name="json">Complete JSON text</param>
    /// <param name="read">Generated reader</param>
    /// <param name="binding">Binding name, http or ipc</param>
    /// <returns>Atomic decoded result</returns>
    internal static Result<Accepted<T>, ContractFailure> Decode<T>(string json, Func<JsonElement, ReadContext, string, string, string?, T> read, string binding) => Decode(json, read, binding, new ReadContext());
    /// <summary>Standard-parser boundary continuing an accumulator that already holds observations</summary>
    /// <typeparam name="T">Contract representation</typeparam>
    /// <param name="json">Complete JSON text</param>
    /// <param name="read">Generated reader</param>
    /// <param name="binding">Binding name, http or ipc</param>
    /// <param name="c">Accumulator that carries earlier observations into the result</param>
    /// <returns>Atomic decoded result</returns>
    internal static Result<Accepted<T>, ContractFailure> Decode<T>(string json, Func<JsonElement, ReadContext, string, string, string?, T> read, string binding, ReadContext c)
    {
        try
        {
            var element = JsonSerializer.Deserialize(json, ContractJsonContext.Default.JsonElement);
            return c.Finish(read(element, c, "", binding, null));
        }
        catch (JsonException) { c.Add("", "json"); return c.Finish(default(T)!); }
        catch (ArgumentException exception) when (exception is ArgumentNullException || exception.InnerException is EncoderFallbackException) { c.Add("", "json"); return c.Finish(default(T)!); }
    }
    /// <summary>Standard JSON output boundary</summary>
    /// <typeparam name="T">Contract representation</typeparam>
    /// <param name="value">Completed value</param>
    /// <param name="write">Generated writer</param>
    /// <param name="binding">Binding name, http or ipc</param>
    /// <returns>UTF-8 JSON text</returns>
    internal static string Encode<T>(T value, Action<Utf8JsonWriter, T, string, string?> write, string binding)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream)) write(writer, value, binding, null);
        return Encoding.UTF8.GetString(stream.GetBuffer(), 0, checked((int)stream.Length));
    }
    /// <summary>Unicode scalar sequence validation</summary>
    /// <param name="value">UTF-16 input</param>
    /// <param name="minimum">Minimum code point count, if restricted</param>
    /// <param name="maximum">Maximum code point count, if restricted</param>
    /// <param name="uuid">Whether the text must spell a UUID</param>
    /// <param name="c">Violation accumulator of the current boundary</param>
    /// <param name="path">Pointer of the text</param>
    internal static void Text(string? value, int? minimum, int? maximum, bool uuid, ReadContext c, string path)
    {
        if (value is null) { c.Add(path, "null"); return; }
        int count = 0;
        var span = value.AsSpan();
        while (!span.IsEmpty)
        {
            if (Rune.DecodeFromUtf16(span, out _, out int consumed) != System.Buffers.OperationStatus.Done) { c.Add(path, "format"); return; }
            count++; span = span[consumed..];
        }
        if (minimum is int min && count < min) c.Add(path, "minLength");
        if (maximum is int max && count > max) c.Add(path, "maxLength");
        if (uuid && (value.Length != 36 || !Guid.TryParseExact(value, "D", out _))) c.Add(path, "format");
    }
    /// <summary>Exact range validation</summary>
    /// <param name="text">Validated numeric token</param>
    /// <param name="minimum">Lower boundary spelling, if restricted</param>
    /// <param name="minExclusive">Whether the lower boundary itself is excluded</param>
    /// <param name="maximum">Upper boundary spelling, if restricted</param>
    /// <param name="maxExclusive">Whether the upper boundary itself is excluded</param>
    /// <param name="c">Violation accumulator of the current boundary</param>
    /// <param name="path">Pointer of the number</param>
    internal static void Range(string text, string? minimum, bool minExclusive, string? maximum, bool maxExclusive, ReadContext c, string path)
    {
        if (minimum is not null) { int n = Compare(text, minimum); if (n < 0 || n == 0 && minExclusive) c.Add(path, "minimum"); }
        if (maximum is not null) { int n = Compare(text, maximum); if (n > 0 || n == 0 && maxExclusive) c.Add(path, "maximum"); }
    }
    /// <summary>JSON string token of a decoded name</summary>
    /// <param name="text">Valid UTF-16 text</param>
    /// <returns>Quoted and escaped token</returns>
    internal static string Quote(string text)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream)) writer.WriteStringValue(text);
        return Encoding.UTF8.GetString(stream.GetBuffer(), 0, checked((int)stream.Length));
    }
    /// <summary>Object formed from mapped parameters and the members of a request body object</summary>
    /// <param name="mapped">JSON object of parameters placed outside the body</param>
    /// <param name="body">JSON body text; empty means an object without members</param>
    /// <param name="placed">Wire names of the placed parameters, which a body member never overrides</param>
    /// <param name="c">Violation accumulator of the current boundary</param>
    /// <returns>Merged JSON object, or null after a recorded violation</returns>
    internal static string? MergeObject(string mapped, string body, IReadOnlyCollection<string> placed, ReadContext c)
    {
        try
        {
            using var document = JsonDocument.Parse(body.Length == 0 ? "{}" : body);
            if (document.RootElement.ValueKind != JsonValueKind.Object) { c.Add("", "type"); return null; }
            var members = new List<string>();
            if (mapped.Length > 2) members.Add(mapped[1..^1]);
            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (!TryName(property, c, "", out var key)) continue;
                if (placed.Contains(key)) c.Unknown("", key);
                else members.Add(Quote(key) + ":" + property.Value.GetRawText());
            }
            return c.IsValid ? "{" + string.Join(",", members) + "}" : null;
        }
        catch (JsonException) { c.Add("", "json"); return null; }
    }
    /// <summary>Object formed from mapped parameters and one body value that is itself a member</summary>
    /// <param name="mapped">JSON object of parameters placed outside the body</param>
    /// <param name="member">Wire name of the member that holds the body value</param>
    /// <param name="body">JSON body text, or null when the request has no body</param>
    /// <param name="c">Violation accumulator of the current boundary</param>
    /// <returns>Merged JSON object, or null after a recorded violation</returns>
    internal static string? MergeMember(string mapped, string member, string? body, ReadContext c)
    {
        if (body is null) return mapped;
        try
        {
            using var document = JsonDocument.Parse(body);
            string own = mapped.Length > 2 ? "," + mapped[1..^1] : "";
            return "{" + Quote(member) + ":" + document.RootElement.GetRawText() + own + "}";
        }
        catch (JsonException) { c.Add("", "json"); return null; }
    }
}
`;
