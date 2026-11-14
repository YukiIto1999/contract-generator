using System.Text;
using System.Text.Json;
using Exhaustiveness;
using Exhaustiveness.Provider;
using TypeModeling.Domain;

/// <summary>Consumer of every generated closed hierarchy across assembly boundaries</summary>
internal static class ExhaustiveConsumer
{
    /// <summary>JSON-lines observation of closed values and rejected open inputs</summary>
    public static void Main()
    {
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            using var request = JsonDocument.Parse(line);
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                writer.WriteString("choice", ChoiceCodec.Decode(request.RootElement.GetProperty("choice").GetRawText()).Value switch
                {
                    Succeeded<Accepted<Choice>> accepted => ChoiceName(accepted.Value.Value),
                    Failed<ContractFailure> => "rejected",
                });
                writer.WriteString("mixed", MixedCodec.Decode(request.RootElement.GetProperty("mixed").GetRawText()).Value switch
                {
                    Succeeded<Accepted<Mixed>> accepted => MixedName(accepted.Value.Value),
                    Failed<ContractFailure> => "rejected",
                });
                writer.WriteEndObject();
            }
            Console.WriteLine(Encoding.UTF8.GetString(stream.ToArray()));
        }
    }

    /// <summary>Discriminator-selected public variant</summary>
    /// <param name="value">Decoded choice</param>
    /// <returns>Public variant name</returns>
    public static string ChoiceName(Choice value) => value switch
    {
        Choice.Text => "text",
        Choice.Number => "number",
    };

    /// <summary>Exact mixed-enumeration member kind</summary>
    /// <param name="value">Decoded member</param>
    /// <returns>Public member kind</returns>
    public static string MixedName(Mixed value) => value switch
    {
        Mixed.Text => "text",
        Mixed.Number => "number",
    };

    /// <summary>Distinct successful operation result</summary>
    /// <param name="value">Successful operation result</param>
    /// <returns>Declared result name</returns>
    public static string SuccessName(ChooseSuccess value) => value switch
    {
        ChooseSuccess.Created => "created",
        ChooseSuccess.Completed => "completed",
    };

    /// <summary>Distinct declared operation rejection</summary>
    /// <param name="value">Declared rejection</param>
    /// <returns>Declared rejection name</returns>
    public static string RejectionName(ChooseRejection value) => value switch
    {
        ChooseRejection.Refused => "refused",
        ChooseRejection.Missing => "missing",
    };

    /// <summary>Origin of an expected operation failure</summary>
    /// <param name="value">Expected operation failure</param>
    /// <returns>Failure origin</returns>
    public static string FailureName(ChooseFailure value) => value switch
    {
        ChooseFailure.InvalidInput => "input",
        ChooseFailure.Declared declared => RejectionName(declared.Rejection),
        ChooseFailure.Communication => "communication",
    };

    /// <summary>Provider dispatch failure origin</summary>
    /// <param name="value">Expected provider failure</param>
    /// <returns>Dispatch or operation failure origin</returns>
    public static string ProviderFailureName(ProviderFailure value) => value switch
    {
        ProviderFailure.UnknownOperation => "unknown-operation",
        ProviderFailure.Choose choose => FailureName(choose.Failure),
    };
}
