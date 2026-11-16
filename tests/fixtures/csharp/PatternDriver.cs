using System.Reflection;
using System.Text;
using System.Text.Json;
using Patterns;
using TypeModeling.Domain;

/// <summary>JSON-lines observations of the generated public boundaries of the pattern contract, found by their declared name</summary>
internal static class PatternDriver
{
    /// <summary>Public codec boundaries of the generated types assembly</summary>
    private static readonly Assembly Types = Assembly.Load("Contract.Types");

    /// <summary>Standard-input protocol: one request with a type, an api and a payload per line; a request may give the payload as UTF-16 code units, which JSON text cannot carry when they are unpaired surrogates</summary>
    /// <returns>Process success code</returns>
    public static int Main()
    {
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            using var request = JsonDocument.Parse(line);
            var root = request.RootElement;
            var name = root.GetProperty("type").GetString()!;
            var codec = Types.GetType("Patterns." + name + "Codec") ?? throw new InvalidOperationException("Unknown fixture boundary " + name);
            var api = root.GetProperty("api").GetString()!;
            var payload = root.TryGetProperty("units", out var units)
                ? new string(units.EnumerateArray().Select(unit => (char)unit.GetInt32()).ToArray())
                : root.GetProperty("payload").GetString()!;
            var create = api == "create";
            var method = codec.GetMethod(create ? "Create" : "Decode", create ? new[] { typeof(string) } : new[] { typeof(string), typeof(string) })
                ?? throw new InvalidOperationException("Unknown fixture api " + api);
            var result = method.Invoke(null, create ? new object[] { payload } : new object[] { payload, "ipc" })!;
            var accepted = result.GetType().GetGenericArguments()[0].GetGenericArguments()[0];
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                typeof(PatternDriver).GetMethod(nameof(Observe), BindingFlags.NonPublic | BindingFlags.Static)!
                    .MakeGenericMethod(accepted).Invoke(null, new object[] { result, writer });
                writer.WriteEndObject();
            }
            Console.WriteLine(Encoding.UTF8.GetString(stream.ToArray()));
        }
        return 0;
    }

    /// <summary>Generated Result observation without independent validation</summary>
    /// <typeparam name="T">Generated representation</typeparam>
    /// <param name="result">Actual generated boundary result</param>
    /// <param name="writer">JSON observation output</param>
    private static void Observe<T>(Result<Accepted<T>, ContractFailure> result, Utf8JsonWriter writer)
    {
        if (!result.IsFailed(out var rejected, out var accepted))
        {
            writer.WriteBoolean("accepted", true);
            if (accepted.Value is string text) writer.WriteString("value", text);
            return;
        }
        writer.WriteBoolean("accepted", false);
        writer.WriteStartArray("violations");
        foreach (var violation in rejected.Failure.Violations)
        {
            writer.WriteStartObject(); writer.WriteString("path", violation.Path); writer.WriteString("rule", violation.Rule); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }
}
