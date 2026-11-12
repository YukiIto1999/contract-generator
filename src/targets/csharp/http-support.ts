/** HTTP primitives that both dependency units need, emitted as source into each */
export const httpCommon = String.raw`
/// <summary>Native HTTP binding primitives</summary>
internal static partial class HttpWire
{
    /// <summary>Strict UTF-8 conversion without replacement</summary>
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    /// <summary>Normalized media-type essence</summary>
    /// <param name="value">Header value, or null when the header is absent</param>
    /// <returns>Case-insensitive essence, empty when the header is absent</returns>
    internal static string Essence(string? value) => (value ?? "").Split(';', 2)[0].Trim().ToLowerInvariant();
    /// <summary>Strict UTF-8 boundary without replacement characters</summary>
    /// <param name="bytes">Native message bytes</param>
    /// <param name="text">Decoded JSON text</param>
    /// <returns>Whether the bytes are valid UTF-8</returns>
    internal static bool Utf8(byte[] bytes, out string text) {
        try { text = StrictUtf8.GetString(bytes); return true; }
        catch (DecoderFallbackException) { text = ""; return false; }
    }
}
`;

/** HTTP primitives of the consumer unit */
export const httpClientSupport = String.raw`
/// <summary>Native HTTP binding primitives</summary>
internal static partial class HttpWire
{
    /// <summary>Exact case-insensitive header-name selector</summary>
    /// <param name="response">Native response</param>
    /// <param name="key">Header name</param>
    /// <param name="value">Required exact value</param>
    /// <returns>Whether the header occurs once with exactly this value</returns>
    internal static bool Header(HttpResponseMessage response, string key, string value) =>
        (response.Headers.TryGetValues(key, out var values) || response.Content.Headers.TryGetValues(key, out values)) && values.Count() == 1 && values.First() == value;
    /// <summary>Scalar HTTP text extraction from encoded JSON</summary>
    /// <param name="json">Validated scalar JSON</param>
    /// <returns>Parameter text</returns>
    internal static string Scalar(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.ValueKind == JsonValueKind.String ? document.RootElement.GetString()! : document.RootElement.GetRawText();
    }
    /// <summary>Path segment that carries a parameter text unchanged</summary>
    /// <param name="text">Parameter text</param>
    /// <param name="segment">Percent-encoded segment</param>
    /// <returns>Whether one segment can carry the text, which excludes the empty text and the dot segments</returns>
    internal static bool PathSegment(string text, out string segment)
    {
        segment = text is "" or "." or ".." ? "" : Uri.EscapeDataString(text);
        return segment.Length != 0;
    }
    /// <summary>Header field value that cannot frame another header or request</summary>
    /// <param name="text">Parameter text</param>
    /// <returns>Whether the text holds no control character other than horizontal tab</returns>
    internal static bool HeaderText(string text)
    {
        foreach (char c in text) if ((c < ' ' && c != '\t') || c == '\u007f') return false;
        return true;
    }
    /// <summary>Origin identity of a constructed request URI</summary>
    /// <param name="origin">Configured service origin</param>
    /// <param name="target">Constructed request URI</param>
    /// <returns>Whether scheme, host and port are those of the service origin</returns>
    internal static bool SameOrigin(Uri origin, Uri target) =>
        origin.Scheme == target.Scheme && origin.Host == target.Host && origin.Port == target.Port;
}
`;

/** HTTP primitives of the provider unit */
export const httpProviderSupport = String.raw`
/// <summary>Native HTTP binding primitives</summary>
internal static partial class HttpWire
{
    /// <summary>Segment-aware route matching</summary>
    /// <param name="template">Declared absolute route</param>
    /// <param name="path">Escaped request path</param>
    /// <param name="values">Decoded route parameter values</param>
    /// <returns>Whether the path matches the template segment by segment</returns>
    internal static bool Route(string template, string path, out Dictionary<string, string> values)
    {
        values = new(StringComparer.Ordinal);
        var expected = template.Split('/'); var actual = path.Split('/');
        if (expected.Length != actual.Length) return false;
        for (int i = 0; i < expected.Length; i++)
        {
            if (expected[i].StartsWith('{') && expected[i].EndsWith('}')) values[expected[i][1..^1]] = Uri.UnescapeDataString(actual[i]);
            else if (!string.Equals(expected[i], actual[i], StringComparison.Ordinal)) return false;
        }
        return true;
    }
    /// <summary>Single-valued query parameter extraction</summary>
    /// <param name="uri">Request URI</param>
    /// <param name="key">Wire parameter name</param>
    /// <param name="duplicate">Whether the wire name occurs more than once</param>
    /// <returns>Last present scalar text, or null when absent</returns>
    internal static string? Query(Uri uri, string key, out bool duplicate)
    {
        duplicate = false; string? found = null;
        foreach (var part in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            if (Uri.UnescapeDataString(pair[0].Replace('+', ' ')) != key) continue;
            if (found is not null) duplicate = true;
            found = Uri.UnescapeDataString((pair.Length == 2 ? pair[1] : "").Replace('+', ' '));
        }
        return found;
    }
    /// <summary>Scalar HTTP text conversion through the standard JSON writer</summary>
    /// <param name="text">HTTP parameter text</param>
    /// <param name="asString">Whether the parameter is a JSON string</param>
    /// <returns>JSON token for the generated codec</returns>
    internal static string Token(string text, bool asString)
    {
        if (!asString) return text;
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream)) writer.WriteStringValue(text);
        return Encoding.UTF8.GetString(stream.ToArray());
    }
    /// <summary>Single positioned violation of a request that never reached the codec</summary>
    /// <param name="path">Pointer of the offending value</param>
    /// <param name="rule">Semantic rule that the request broke</param>
    /// <returns>Rejection without unknown-member observations</returns>
    internal static ContractFailure Reject(string path, string rule) => new([new(path, rule)], []);
}
`;
