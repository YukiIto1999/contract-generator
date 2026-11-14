using System.Collections.Immutable;
using System.Text;
using System.Text.Json;
using Sample;
using TypeModeling.Domain;

/// <summary>JSON-lines observations of generated public boundaries</summary>
internal static class CodecDriver
{
    /// <summary>Standard-input codec protocol</summary>
    /// <returns>Process success code</returns>
    public static int Main()
    {
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            using var request = JsonDocument.Parse(line);
            var root = request.RootElement;
            string type = root.GetProperty("type").GetString()!;
            string payload = root.TryGetProperty("payloadUnits", out var units) ? new string(units.EnumerateArray().Select(unit => (char)unit.GetInt32()).ToArray()) : root.TryGetProperty("payload", out var p) ? p.GetString()! : "null";
            string binding = root.TryGetProperty("binding", out var b) ? b.GetString()! : "http";
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                switch (type)
                {
                    case "Envelope":
                        Observe(EnvelopeCodec.Decode(payload, binding), value => EnvelopeCodec.Encode(value, binding), writer);
                        break;
                    case "EnvelopeConstruction":
                        Construct(root, payload, binding, writer);
                        break;
                    case "RequestId":
                        Observe(RequestIdCodec.Decode(payload, binding), value => RequestIdCodec.Encode(value, binding), writer);
                        break;
                    case "RecordId":
                        Observe(RecordIdCodec.Decode(payload, binding), value => RecordIdCodec.Encode(value, binding), writer);
                        break;
                    case "ShortLabel":
                        Observe(ShortLabelCodec.Decode(payload, binding), value => ShortLabelCodec.Encode(value, binding), writer);
                        break;
                    case "ShortLabelConstruction":
                        Observe(ShortLabelCodec.Create(payload), value => ShortLabelCodec.Encode(value, binding), writer);
                        break;
                    case "SmallCount":
                        Observe(SmallCountCodec.Decode(payload, binding), value => SmallCountCodec.Encode(value, binding), writer);
                        break;
                    case "ExactDecimal":
                        Observe(ExactDecimalCodec.Decode(payload, binding), value => ExactDecimalCodec.Encode(value, binding), writer);
                        break;
                    case "ExactTimestamp":
                        Observe(ExactTimestampCodec.Decode(payload, binding), value => ExactTimestampCodec.Encode(value, binding), writer);
                        break;
                    case "Item":
                        Observe(ItemCodec.Decode(payload, binding), value => ItemCodec.Encode(value, binding), writer);
                        break;
                    case "DefaultRequestId":
                        Observe(RequestIdCodec.Validate(default), value => RequestIdCodec.Encode(value, binding), writer);
                        break;
                    case "DefaultRequestIdEncode":
                        ObserveEncoded(RequestIdCodec.Encode(default, binding), writer);
                        break;
                    default:
                        throw new InvalidOperationException("Unknown fixture boundary");
                }
                writer.WriteEndObject();
            }
            Console.WriteLine(Encoding.UTF8.GetString(stream.ToArray()));
        }
        return 0;
    }

    /// <summary>Construction through the generated factory with owned collection input</summary>
    /// <param name="request">Construction overrides</param>
    /// <param name="payload">Baseline raw JSON</param>
    /// <param name="binding">Wire representation</param>
    /// <param name="writer">Observation output</param>
    private static void Construct(JsonElement request, string payload, string binding, Utf8JsonWriter writer)
    {
        var decoded = EnvelopeCodec.Decode(payload, binding);
        if (decoded.IsFailed(out _, out var accepted))
        {
            Observe(decoded, value => EnvelopeCodec.Encode(value, binding), writer);
            return;
        }
        var source = accepted.Value;
        var mutable = source.Items.ToArray();
        string label = request.TryGetProperty("label", out var labelProperty) ? labelProperty.GetString()! : source.Label;
        int count = request.TryGetProperty("count", out var countProperty) ? countProperty.GetInt32() : source.Count;
        RequestId requestId = request.TryGetProperty("defaultRequestId", out var defaulted) && defaulted.GetBoolean() ? default : source.RequestId;
        Item[] items = request.TryGetProperty("nullItems", out var nulled) && nulled.GetBoolean() ? null! : mutable;
        var result = Envelope.Create(
            requestId: requestId,
            recordId: source.RecordId,
            correlationId: source.CorrelationId,
            label: label,
            count: count,
            amount: source.Amount,
            occurredAt: source.OccurredAt,
            nullableText: source.NullableText,
            optionalText: source.OptionalText,
            optionalNullable: source.OptionalNullable,
            items: items);
        if (mutable.Length > 0) mutable[0] = null!;
        Observe(result, value => EnvelopeCodec.Encode(value, binding), writer);
    }

    /// <summary>Generated Result observation without independent validation</summary>
    /// <typeparam name="T">Generated representation</typeparam>
    /// <param name="result">Actual generated boundary result</param>
    /// <param name="encode">Actual generated output codec</param>
    /// <param name="writer">JSON observation output</param>
    private static void Observe<T>(Result<Accepted<T>, ContractFailure> result, Func<T, Result<string, ContractFailure>> encode, Utf8JsonWriter writer)
    {
        if (!result.IsFailed(out var failed, out var accepted))
        {
            writer.WriteBoolean("accepted", true);
            var encoded = encode(accepted.Value);
            if (encoded.IsFailed(out _, out var json)) throw new InvalidOperationException("Accepted generated value failed output guard");
            writer.WriteString("encoded", json);
            Diagnostics(writer, accepted.Diagnostics);
            writer.WriteStartArray("violations"); writer.WriteEndArray();
            return;
        }
        var rejected = failed.Failure;
        writer.WriteBoolean("accepted", false);
        Diagnostics(writer, rejected.Diagnostics);
        writer.WriteStartArray("violations");
        foreach (var violation in rejected.Violations)
        {
            writer.WriteStartObject(); writer.WriteString("path", violation.Path); writer.WriteString("rule", violation.Rule); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    /// <summary>Generated output-guard observation without independent validation</summary>
    /// <param name="result">Actual generated encoding result</param>
    /// <param name="writer">JSON observation output</param>
    private static void ObserveEncoded(Result<string, ContractFailure> result, Utf8JsonWriter writer)
    {
        if (!result.IsFailed(out var failed, out var json))
        {
            writer.WriteBoolean("accepted", true);
            writer.WriteString("encoded", json);
            Diagnostics(writer, ImmutableArray<UnknownProperty>.Empty);
            writer.WriteStartArray("violations"); writer.WriteEndArray();
            return;
        }
        var rejected = failed.Failure;
        writer.WriteBoolean("accepted", false);
        Diagnostics(writer, rejected.Diagnostics);
        writer.WriteStartArray("violations");
        foreach (var violation in rejected.Violations)
        {
            writer.WriteStartObject(); writer.WriteString("path", violation.Path); writer.WriteString("rule", violation.Rule); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    /// <summary>Value-free unknown-property diagnostics</summary>
    /// <param name="writer">Observation output</param>
    /// <param name="diagnostics">Generated unknown-property observations</param>
    private static void Diagnostics(Utf8JsonWriter writer, ImmutableArray<UnknownProperty> diagnostics)
    {
        writer.WriteStartArray("diagnostics");
        foreach (var diagnostic in diagnostics)
        {
            writer.WriteStartObject(); writer.WriteString("path", diagnostic.Path); writer.WriteString("key", diagnostic.Key); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }
}
