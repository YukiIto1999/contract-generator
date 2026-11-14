using System.Collections.Immutable;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using DepthFixture;
using DepthFixture.Provider;
using EffectSystem.Domain;
using TypeModeling.Domain;

internal static class DepthDriver
{
    public static async Task<int> Main()
    {
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            using var request = JsonDocument.Parse(line);
            var input = request.RootElement;
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                string mode = input.GetProperty("mode").GetString()!;
                if (mode == "http") await Http(input, writer);
                else if (mode == "defaults") Defaults(input.GetProperty("depth").GetInt32(), writer);
                else if (mode == "array-guards") ArrayGuards(writer);
                else if (mode == "lifecycle") Lifecycle(input.GetProperty("depth").GetInt32(), writer);
                else
                {
                    string kind = input.GetProperty("kind").GetString()!;
                    int depth = input.TryGetProperty("depth", out var d) ? d.GetInt32() : 0;
                    string leaf = input.TryGetProperty("leaf", out var l) ? l.GetString()! : "leaf";
                    string payload = input.TryGetProperty("payloadUnits", out var units)
                        ? new string(units.EnumerateArray().Select(unit => (char)unit.GetInt32()).ToArray())
                        : input.TryGetProperty("payload", out var p) ? p.GetString()! : "null";
                    switch (kind)
                    {
                        case "object":
                            Observe(mode == "construct" ? ConstructObject(depth, leaf) : ObjectNodeCodec.Decode(payload), ObjectNodeCodec.Encode, ObjectNodeCodec.Decode, ObjectSummary, writer);
                            break;
                        case "array":
                            Observe(mode == "construct" ? ConstructArray(depth) : ArrayNodeCodec.Decode(payload), ArrayNodeCodec.Encode, ArrayNodeCodec.Decode, ArraySummary, writer);
                            break;
                        case "union":
                            Observe(mode == "construct" ? ConstructUnion(depth, leaf) : ChoiceCodec.Decode(payload), ChoiceCodec.Encode, ChoiceCodec.Decode, UnionSummary, writer);
                            break;
                        default: throw new InvalidOperationException("Unknown depth fixture kind");
                    }
                }
                writer.WriteEndObject();
            }
            Console.WriteLine(Encoding.UTF8.GetString(stream.ToArray()));
        }
        return 0;
    }

    private static T Required<T>(Result<Accepted<T>, ContractFailure> result)
    {
        if (result.IsFailed(out Failed<ContractFailure> failed, out var accepted))
            throw new InvalidOperationException(JsonSerializer.Serialize(failed.Failure));
        return accepted.Value;
    }

    private static Result<Accepted<ObjectNode>, ContractFailure> ConstructObject(int depth, string leaf)
    {
        var result = ObjectNode.Create(value: leaf, child: default, note: default, stable: default);
        for (int i = 0; i < depth; i++)
            result = ObjectNode.Create(value: "branch", child: Presence<ObjectNode?>.Present(Required(result)), note: default, stable: default);
        return result;
    }

    private static Result<Accepted<ArrayNodeCodec.Value>, ContractFailure> ConstructArray(int depth)
    {
        var result = ArrayNodeCodec.Create(Array.Empty<ArrayNodeCodec.Value>());
        for (int i = 0; i < depth; i++) result = ArrayNodeCodec.Create(new[] { Required(result) });
        return result;
    }

    private static Result<Accepted<Choice>, ContractFailure> ConstructUnion(int depth, string leaf)
    {
        var result = Choice.End.Create(Required(EndNode.Create(kind: "end", value: leaf)));
        for (int i = 0; i < depth; i++)
            result = Choice.Step.Create(Required(StepNode.Create(kind: "step", next: Required(result))));
        return result;
    }

    private static void Lifecycle(int depth, Utf8JsonWriter writer)
    {
        var union = Required(ConstructUnion(depth, "leaf"));
        var payload = ((Choice.Step)union).Value;
        var samePayload = Required(Choice.Step.Create(payload));
        var cloned = union with { };
        var differentPayload = Required(Choice.Step.Create(Required(StepNode.Create(kind: "step", next: payload.Next))));
        var differentVariant = Required(Choice.End.Create(Required(EndNode.Create(kind: "end", value: "leaf"))));
        if (ChoiceCodec.Encode(union).IsFailed(out Failed<ContractFailure> failed, out var json))
            throw new InvalidOperationException(JsonSerializer.Serialize(failed.Failure));
        var decoded = Required(ChoiceCodec.Decode(json));
        writer.WriteBoolean("unionSameInstance", union.Equals(union));
        writer.WriteBoolean("unionSamePayload", union.Equals(samePayload));
        writer.WriteBoolean("unionDifferentPayload", union.Equals(differentPayload));
        writer.WriteBoolean("unionDifferentVariant", union.Equals(differentVariant));
        writer.WriteBoolean("unionDecodedPayload", union.Equals(decoded));
        writer.WriteBoolean("unionHashConsistent", union.GetHashCode() == samePayload.GetHashCode());
        writer.WriteBoolean("unionDisplay", !string.IsNullOrEmpty(union.ToString()) && !string.IsNullOrEmpty(samePayload.ToString()));
        writer.WriteBoolean("unionCloneDistinct", !ReferenceEquals(union, cloned));
        writer.WriteBoolean("unionClonePayload", ReferenceEquals(payload, ((Choice.Step)cloned).Value));
        writer.WriteBoolean("unionCloneEqual", union.Equals(cloned));
        writer.WriteBoolean("unionCloneHash", union.GetHashCode() == cloned.GetHashCode());
        writer.WriteBoolean("unionCloneDisplay", union.ToString() == cloned.ToString());

        var model = Required(ConstructObject(depth, "leaf"));
        var otherModel = Required(ObjectNode.Create(value: model.Value, child: model.Child, note: model.Note, stable: model.Stable));
        writer.WriteBoolean("objectSameInstance", model.Equals(model));
        writer.WriteBoolean("objectDifferentInstance", model.Equals(otherModel));
        writer.WriteBoolean("objectHashConsistent", model.GetHashCode() == model.GetHashCode());
        writer.WriteBoolean("objectDisplay", !string.IsNullOrEmpty(model.ToString()));

        var array = Required(ConstructArray(depth));
        var copy = array;
        var otherArray = Required(ArrayNodeCodec.Create(new[] { array[0] }));
        writer.WriteBoolean("arrayCopiedStorage", array.Equals(copy));
        writer.WriteBoolean("arrayDifferentStorage", array.Equals(otherArray));
        writer.WriteBoolean("arrayHashConsistent", array.GetHashCode() == copy.GetHashCode());
        writer.WriteBoolean("arrayDisplay", !string.IsNullOrEmpty(array.ToString()));
    }

    private static void ObjectSummary(ObjectNode value, Utf8JsonWriter writer)
    {
        int depth = 0;
        while (value.Child.IsPresent && value.Child.Value is not null)
        {
            if (value.Value != "branch") throw new InvalidOperationException("Changed object branch");
            value = value.Child.Value;
            depth++;
        }
        writer.WriteNumber("depth", depth);
        writer.WriteString("leaf", value.Value);
    }

    private static void ArraySummary(ArrayNodeCodec.Value value, Utf8JsonWriter writer)
    {
        int depth = 0;
        while (value.Length != 0)
        {
            if (value.IsDefault || value.Length != 1) throw new InvalidOperationException("Changed array branch");
            int enumerated = 0;
            foreach (var child in value)
            {
                if (child.IsDefault) throw new InvalidOperationException("Default array child");
                enumerated++;
            }
            if (enumerated != 1) throw new InvalidOperationException("Changed array enumeration");
            value = value[0];
            depth++;
        }
        writer.WriteNumber("depth", depth);
        writer.WriteNumber("leaf", value.Length);
        writer.WriteBoolean("isDefault", value.IsDefault);
    }

    private static void UnionSummary(Choice value, Utf8JsonWriter writer)
    {
        int depth = 0;
        while (value is Choice.Step step)
        {
            if (step.Value.Kind != "step") throw new InvalidOperationException("Changed union discriminator");
            value = step.Value.Next;
            depth++;
        }
        if (value is not Choice.End end || end.Value.Kind != "end")
            throw new InvalidOperationException("Changed union leaf variant");
        writer.WriteNumber("depth", depth);
        writer.WriteString("leaf", end.Value.Value);
    }

    private static void Observe<T>(
        Result<Accepted<T>, ContractFailure> result,
        Func<T, string, Result<string, ContractFailure>> encode,
        Func<string, string, Result<Accepted<T>, ContractFailure>> decode,
        Action<T, Utf8JsonWriter> summarize,
        Utf8JsonWriter writer)
    {
        if (result.IsFailed(out Failed<ContractFailure> failed, out var accepted))
        {
            Failure(failed.Failure, writer);
            return;
        }
        var encoded = encode(accepted.Value, "http");
        if (encoded.IsFailed(out Failed<ContractFailure> encodeFailed, out var json))
            throw new InvalidOperationException(JsonSerializer.Serialize(encodeFailed.Failure));
        var roundtrip = Required(decode(json, "http"));
        writer.WriteBoolean("accepted", true);
        writer.WriteString("encoded", json);
        writer.WriteStartObject("before"); summarize(accepted.Value, writer); writer.WriteEndObject();
        writer.WriteStartObject("after"); summarize(roundtrip, writer); writer.WriteEndObject();
        Diagnostics(accepted.Diagnostics, writer);
        writer.WriteStartArray("violations"); writer.WriteEndArray();
    }

    private static void Failure(ContractFailure failure, Utf8JsonWriter writer)
    {
        writer.WriteBoolean("accepted", false);
        Diagnostics(failure.Diagnostics, writer);
        writer.WriteStartArray("violations");
        foreach (var violation in failure.Violations)
        {
            writer.WriteStartObject();
            writer.WriteString("path", violation.Path);
            writer.WriteString("rule", violation.Rule);
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    private static void Diagnostics(ImmutableArray<UnknownProperty> diagnostics, Utf8JsonWriter writer)
    {
        writer.WriteStartArray("diagnostics");
        foreach (var diagnostic in diagnostics)
        {
            writer.WriteStartObject();
            writer.WriteString("path", diagnostic.Path);
            writer.WriteString("key", diagnostic.Key);
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    private static void Defaults(int depth, Utf8JsonWriter writer)
    {
        var stable = Required(Stable.Create("identity"));
        var leaf = Required(ObjectNode.Create(value: "leaf", child: Presence<ObjectNode?>.Present(null), note: Presence<string?>.Present(null), stable: Presence<Stable>.Present(stable)));
        var tree = leaf;
        for (int i = 0; i < depth; i++)
            tree = Required(ObjectNode.Create(value: "branch", child: Presence<ObjectNode?>.Present(tree), note: default, stable: Presence<Stable>.Present(stable)));
        var input = Required(EchoInput.Create(root: tree, arrays: default, choice: default, branch: default));
        var accepted = Required(EchoAcceptance.Accept(input));
        var node = accepted.Root;
        int defaults = 0;
        bool identities = true;
        while (node.Child.IsPresent && node.Child.Value is not null)
        {
            identities &= ReferenceEquals(stable, node.Stable.Value);
            if (node.Note.IsPresent && node.Note.Value == "fallback") defaults++;
            node = node.Child.Value;
        }
        identities &= ReferenceEquals(stable, node.Stable.Value);
        writer.WriteNumber("defaults", defaults);
        writer.WriteBoolean("stableIdentity", identities);
        writer.WriteBoolean("nullPreserved", node.Note.IsPresent && node.Note.Value is null && node.Child.IsPresent && node.Child.Value is null);
        writer.WriteBoolean("sourceUnchanged", !tree.Note.IsPresent && leaf.Note.IsPresent && leaf.Note.Value is null);
        writer.WriteBoolean("dependentDefaults", accepted.Branch.Leaf.IsPresent && accepted.Branch.Leaf.Value.Note.IsPresent && accepted.Branch.Leaf.Value.Note.Value == "fallback");
        writer.WriteBoolean("dependentSourceUnchanged", !input.Branch.IsPresent);
        writer.WriteString("leaf", node.Value);
        writer.WriteBoolean("nullInputRejected", EchoAcceptance.Accept(null!).IsFailed(out Failed<ContractFailure> _, out _));
    }

    private static void ArrayGuards(Utf8JsonWriter writer)
    {
        var empty = Required(ArrayNodeCodec.Create(Array.Empty<ArrayNodeCodec.Value>()));
        var caller = new[] { empty };
        var owned = Required(ArrayNodeCodec.Create(caller));
        caller[0] = default;
        writer.WriteBoolean("defaultRejected", ArrayNodeCodec.Validate(default).IsFailed(out Failed<ContractFailure> _, out _));
        writer.WriteBoolean("defaultEncodeRejected", ArrayNodeCodec.Encode(default).IsFailed(out Failed<ContractFailure> _, out _));
        writer.WriteBoolean("defaultChildRejected", ArrayNodeCodec.Create(new[] { default(ArrayNodeCodec.Value) }).IsFailed(out Failed<ContractFailure> _, out _));
        writer.WriteBoolean("nullEnumerableRejected", ArrayNodeCodec.Create(null!).IsFailed(out Failed<ContractFailure> _, out _));
        writer.WriteBoolean("ownsInput", !owned[0].IsDefault && owned[0].Length == 0);
        writer.WriteBoolean("emptyValid", !empty.IsDefault && empty.Length == 0);
    }

    private static async Task Http(JsonElement input, Utf8JsonWriter writer)
    {
        byte[] bytes = Convert.FromBase64String(input.GetProperty("bodyBase64").GetString()!);
        using var request = new HttpRequestMessage(HttpMethod.Post, "http://localhost/echo") { Content = new ByteArrayContent(bytes) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        var handlers = new Handlers();
        var clock = TimeProvider.System;
        var runtime = new EffectRuntime<IContractHandlers>(handlers, clock, new DeadlineDiagnostics());
        var exit = await runtime.Run(ContractProvider.EchoHttp(request), Deadline.FromBudget(clock, TimeSpan.FromSeconds(120)), _ => new EchoFailure.Communication(new("deadline")), CancellationToken.None);
        switch (exit)
        {
            case EffectExit<EchoFailure, HttpResponseMessage>.Succeeded succeeded:
                using (var response = succeeded.Value)
                {
                    writer.WriteBoolean("accepted", true);
                    writer.WriteNumber("status", (int)response.StatusCode);
                    writer.WriteString("leaf", handlers.Leaf);
                }
                break;
            case EffectExit<EchoFailure, HttpResponseMessage>.Failed failed:
                if (failed.Failure is EchoFailure.InvalidInput invalid) Failure(invalid.Failure, writer);
                else throw new InvalidOperationException("Unexpected HTTP failure");
                break;
            case EffectExit<EchoFailure, HttpResponseMessage>.Defected defected:
                throw new InvalidOperationException("Unexpected HTTP defect", defected.Exception);
            case EffectExit<EchoFailure, HttpResponseMessage>.Canceled:
                throw new InvalidOperationException("Unexpected HTTP cancellation");
        }
        writer.WriteNumber("handlerCalls", handlers.Calls);
    }

    private sealed class Handlers : IContractHandlers
    {
        public int Calls { get; private set; }
        public string? Leaf { get; private set; }
        public Effect<NoRequirements, EchoRejection, EchoSuccess> Echo(EchoAcceptedInput input)
        {
            Calls++;
            var node = input.Root;
            while (node.Child.IsPresent && node.Child.Value is not null) node = node.Child.Value;
            Leaf = node.Value;
            return new EffectContext<NoRequirements, EchoRejection>().Succeed(Required(EchoSuccess.Ok.Create(Required(Stable.Create("ok")))));
        }
    }

    private sealed class DeadlineDiagnostics : IDeadlineDiagnostics
    {
        public void RecordOverrun(Deadline deadline, TimeSpan overrun) => throw new InvalidOperationException("Depth fixture exceeded its deadline");
    }
}
