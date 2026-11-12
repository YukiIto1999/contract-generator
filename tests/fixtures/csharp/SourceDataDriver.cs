using System.Text;
using System.Text.Json;
using SourceData;
using TypeModeling.Domain;

/// <summary>JSON-lines observations of the generated public boundaries of the source-data contract</summary>
internal static class SourceDataDriver
{
    /// <summary>Standard-input protocol: one request with a type and a JSON payload per line</summary>
    /// <returns>Process success code</returns>
    public static int Main()
    {
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            using var request = JsonDocument.Parse(line);
            var root = request.RootElement;
            string payload = root.GetProperty("payload").GetString()!;
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                switch (root.GetProperty("type").GetString())
                {
                    case "Flavor":
                        Observe(FlavorCodec.Decode(payload, "ipc"), value => FlavorCodec.Encode(value, "ipc"), writer);
                        break;
                    case "Specimen":
                        Observe(SpecimenCodec.Decode(payload, "ipc"), value => SpecimenCodec.Encode(value, "ipc"), writer);
                        break;
                    case "Pick":
                        Observe(PickCodec.Decode(payload, "ipc"), value => PickCodec.Encode(value, "ipc"), writer);
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

    /// <summary>Generated Result observation without independent validation</summary>
    /// <typeparam name="T">Generated representation</typeparam>
    /// <param name="result">Actual generated boundary result</param>
    /// <param name="encode">Actual generated output codec</param>
    /// <param name="writer">JSON observation output</param>
    private static void Observe<T>(Result<Accepted<T>, ContractFailure> result, Func<T, Result<string, ContractFailure>> encode, Utf8JsonWriter writer)
    {
        if (result is Result<Accepted<T>, ContractFailure>.Succeeded accepted)
        {
            writer.WriteBoolean("accepted", true);
            var encoded = encode(accepted.Value.Value);
            if (encoded is not Result<string, ContractFailure>.Succeeded json) throw new InvalidOperationException("Accepted generated value failed output guard");
            writer.WriteString("encoded", json.Value);
            return;
        }
        var rejected = ((Result<Accepted<T>, ContractFailure>.Failed)result).Failure;
        writer.WriteBoolean("accepted", false);
        writer.WriteStartArray("violations");
        foreach (var violation in rejected.Violations)
        {
            writer.WriteStartObject(); writer.WriteString("path", violation.Path); writer.WriteString("rule", violation.Rule); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }
}
