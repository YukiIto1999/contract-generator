using System.Collections.Immutable;
using System.Net;
using System.Text;
using System.Text.Json;
using EffectSystem.Domain;
using Features;
using Features.Client;
using Features.Provider;
using TypeModeling.Domain;

/// <summary>JSON-lines observations of the second generated contract's codecs, client and provider</summary>
internal static class FeaturesDriver
{
    /// <summary>Standard-input scenario protocol</summary>
    /// <returns>Process success code</returns>
    public static async Task<int> Main()
    {
        using var transport = new SocketsHttpTransport();
        string? line;
        while ((line = await Console.In.ReadLineAsync()) is not null)
        {
            using var request = JsonDocument.Parse(line);
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                var root = request.RootElement;
                if (root.TryGetProperty("type", out var type))
                    Codec(
                        type.GetString()!,
                        root.GetProperty("payload").GetString()!,
                        root.TryGetProperty("binding", out var b) ? b.GetString()! : "http",
                        writer
                    );
                else if (root.GetProperty("operation").GetString() == "provider")
                    await RawProvider(root, writer);
                else if (root.GetProperty("operation").GetString() == "providerIpc")
                    await RawIpcProvider(root, writer);
                else if (root.GetProperty("operation").GetString() == "direct")
                    await DirectProvider(root, writer);
                else
                    await Operation(root, transport, writer);
                writer.WriteEndObject();
            }
            Console.WriteLine(Encoding.UTF8.GetString(stream.ToArray()));
        }
        return 0;
    }

    /// <summary>Generated public codec observation without independent validation</summary>
    /// <param name="type">Generated boundary name</param>
    /// <param name="payload">Raw JSON</param>
    /// <param name="binding">Wire representation</param>
    /// <param name="writer">Observation output</param>
    /// <exception cref="InvalidOperationException">Unknown fixture boundary</exception>
    private static void Codec(string type, string payload, string binding, Utf8JsonWriter writer)
    {
        switch (type)
        {
            case "Numbers":
                Observe(
                    NumbersCodec.Decode(payload, binding),
                    value => NumbersCodec.Encode(value, binding),
                    writer
                );
                break;
            case "ExactInteger":
                Observe(
                    ExactIntegerCodec.Decode(payload, binding),
                    value => ExactIntegerCodec.Encode(value, binding),
                    writer
                );
                break;
            case "ExactAmount":
                Observe(
                    ExactAmountCodec.Decode(payload, binding),
                    value => ExactAmountCodec.Encode(value, binding),
                    writer
                );
                break;
            case "ExactOffset":
                Observe(
                    ExactOffsetCodec.Decode(payload, binding),
                    value => ExactOffsetCodec.Encode(value, binding),
                    writer
                );
                break;
            case "NonemptyCustomer":
                Observe(
                    NonemptyCustomerCodec.Decode(payload, binding),
                    value => CustomerRoleCodec.Encode(value, binding),
                    writer
                );
                break;
            case "Kinds":
                Observe(
                    KindsCodec.Decode(payload, binding),
                    value => KindsCodec.Encode(value, binding),
                    writer
                );
                break;
            case "MergeRequest":
                MergeRequest(payload, writer);
                break;
            default:
                throw new InvalidOperationException("Unknown fixture boundary");
        }
    }

    /// <summary>Merge of placed parameters and a request body through the generated request codec</summary>
    /// <param name="payload">JSON object holding the placed parameters text and the body text</param>
    /// <param name="writer">Observation output</param>
    private static void MergeRequest(string payload, Utf8JsonWriter writer)
    {
        using var parts = JsonDocument.Parse(payload);
        Observe(
            MergeHttpRequestCodec.Decode(
                parts.RootElement.GetProperty("parameters").GetString()!,
                parts.RootElement.GetProperty("body").GetString()!
            ),
            value => MergeInputCodec.Encode(value, "http"),
            writer
        );
    }

    /// <summary>Hand-written IPC command dispatched straight into the generated provider</summary>
    /// <param name="request">Scenario with the command and its parameters text</param>
    /// <param name="writer">Observation output</param>
    private static async Task RawIpcProvider(JsonElement request, Utf8JsonWriter writer)
    {
        var handlers = new FeatureHandlers("first");
        var clock = TimeProvider.System;
        var diagnostics = new FeatureDeadlineDiagnostics();
        var exit = await new EffectRuntime<IContractHandlers>(handlers, clock, diagnostics).Run(
            ContractProvider.DispatchIpc(
                request.GetProperty("command").GetString()!,
                request.GetProperty("parameters").GetString()!
            ),
            Deadline.FromBudget(clock, TimeSpan.FromSeconds(30)),
            _ => new ProviderFailure.Choose(new ChooseFailure.Communication(new("deadline"))),
            CancellationToken.None
        );
        if (exit is EffectExit<ProviderFailure, string>.Succeeded succeeded)
        {
            writer.WriteString("exit", "responded");
            writer.WriteString("envelope", succeeded.Value);
        }
        else if (exit is EffectExit<ProviderFailure, string>.Failed failed)
            writer.WriteString(
                "exit",
                failed.Failure is ProviderFailure.UnknownOperation ? "unknown-operation" : "failed"
            );
        else
            writer.WriteString(
                "exit",
                exit is EffectExit<ProviderFailure, string>.Defected ? "defected" : "canceled"
            );
        if (handlers.Seen is not null)
        {
            writer.WritePropertyName("handlerSaw");
            writer.WriteRawValue(handlers.Seen);
        }
    }

    /// <summary>Direct provider call that shares provider acceptance with the transports</summary>
    /// <param name="request">Scenario with the raw input JSON of the defaults operation</param>
    /// <param name="writer">Observation output</param>
    private static async Task DirectProvider(JsonElement request, Utf8JsonWriter writer)
    {
        var handlers = new FeatureHandlers("first");
        var input = Required(
            DefaultsInputCodec.Decode(request.GetProperty("payload").GetString()!, "http")
        );
        var clock = TimeProvider.System;
        var diagnostics = new FeatureDeadlineDiagnostics();
        var exit = await new EffectRuntime<IContractHandlers>(handlers, clock, diagnostics).Run(
            ContractProvider.Defaults(input),
            Deadline.FromBudget(clock, TimeSpan.FromSeconds(30)),
            _ => new DefaultsFailure.Communication(new("deadline")),
            CancellationToken.None
        );
        writer.WriteString(
            "exit",
            exit is EffectExit<DefaultsFailure, DefaultsSuccess>.Succeeded ? "succeeded" : "other"
        );
        if (handlers.Seen is not null)
        {
            writer.WritePropertyName("handlerSaw");
            writer.WriteRawValue(handlers.Seen);
        }
    }

    /// <summary>Effective branch observed through the public properties that a handler reads</summary>
    /// <param name="branch">Provider-accepted branch</param>
    /// <returns>JSON object with every defaulted member</returns>
    internal static string Describe(Branch branch)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WritePropertyName("leaf");
            WriteLeaf(writer, branch.Leaf);
            writer.WriteStartArray("leaves");
            foreach (var leaf in branch.Leaves)
                WriteLeaf(writer, leaf);
            writer.WriteEndArray();
            writer.WriteStartArray("shapes");
            foreach (var shape in branch.Shapes)
            {
                writer.WriteStartObject();
                if (shape is Shape.Solid solid)
                {
                    writer.WriteString("kind", "solid");
                    writer.WritePropertyName("leaf");
                    WriteLeaf(writer, solid.Value.Leaf);
                }
                else if (shape is Shape.Plain plain)
                {
                    writer.WriteString("kind", "plain");
                    writer.WriteString("note", plain.Value.Note.Value);
                }
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>Leaf observation through the public properties that a handler reads</summary>
    /// <param name="writer">Observation output</param>
    /// <param name="leaf">Provider-accepted leaf</param>
    private static void WriteLeaf(Utf8JsonWriter writer, Leaf leaf)
    {
        writer.WriteStartObject();
        writer.WriteString("name", leaf.Name);
        writer.WriteString("blob", Convert.ToBase64String(leaf.Blob.Value.AsSpan()));
        writer.WriteBoolean("enabled", leaf.Enabled.Value);
        writer.WriteNumber("count", leaf.Count.Value);
        writer.WriteString("span", leaf.Span.Value);
        writer.WriteString("at", leaf.At.Value);
        writer.WriteEndObject();
    }

    /// <summary>Generated Result observation without independent validation</summary>
    /// <typeparam name="T">Generated representation</typeparam>
    /// <param name="result">Actual generated boundary result</param>
    /// <param name="encode">Actual generated output codec</param>
    /// <param name="writer">JSON observation output</param>
    private static void Observe<T>(
        Result<Accepted<T>, ContractFailure> result,
        Func<T, Result<string, ContractFailure>> encode,
        Utf8JsonWriter writer
    )
    {
        if (!result.IsFailed(out var failed, out var accepted))
        {
            if (encode(accepted.Value).IsFailed(out _, out var json))
                throw new InvalidOperationException("Accepted generated value failed output guard");
            writer.WriteBoolean("accepted", true);
            writer.WriteString("encoded", json);
            Diagnostics(writer, accepted.Diagnostics);
            writer.WriteStartArray("violations");
            writer.WriteEndArray();
            return;
        }
        var rejected = failed.Failure;
        writer.WriteBoolean("accepted", false);
        Diagnostics(writer, rejected.Diagnostics);
        Violations(writer, rejected);
    }

    /// <summary>Value-free unknown-property diagnostics</summary>
    /// <param name="writer">Observation output</param>
    /// <param name="diagnostics">Generated unknown-property observations</param>
    private static void Diagnostics(
        Utf8JsonWriter writer,
        ImmutableArray<UnknownProperty> diagnostics
    )
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

    /// <summary>Positioned violation array output</summary>
    /// <param name="writer">Observation output</param>
    /// <param name="failure">Actual generated failure</param>
    private static void Violations(Utf8JsonWriter writer, ContractFailure failure)
    {
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

    /// <summary>Chosen success output</summary>
    /// <param name="writer">Observation output</param>
    /// <param name="name">Public variant name</param>
    /// <param name="value">Nullable payload observation</param>
    /// <param name="hasValue">Presence of a payload</param>
    /// <returns>Completed observation</returns>
    private static Unit WriteChoice(
        Utf8JsonWriter writer,
        string name,
        string? value,
        bool hasValue = true
    )
    {
        writer.WriteString("case", name);
        if (hasValue)
            writer.WriteString("value", value);
        return Unit.Value;
    }

    /// <summary>Chosen failure output</summary>
    /// <param name="writer">Observation output</param>
    /// <param name="classification">Failure origin</param>
    /// <param name="reason">Declared or communication reason</param>
    /// <param name="input">Positioned input violations</param>
    /// <returns>Completed observation</returns>
    private static Unit WriteChooseFailure(
        Utf8JsonWriter writer,
        string classification,
        string? reason,
        ContractFailure? input = null
    )
    {
        writer.WriteString("exit", classification);
        if (reason is not null)
            writer.WriteString("reason", reason);
        if (input is not null)
            Violations(writer, input);
        return Unit.Value;
    }

    /// <summary>Generated client call through a real socket peer or an in-memory loopback to the generated provider</summary>
    /// <param name="request">Scenario</param>
    /// <param name="transport">Native HTTP transport that follows no redirect</param>
    /// <param name="writer">Observation output</param>
    /// <exception cref="InvalidOperationException">Unknown fixture operation</exception>
    private static async Task Operation(
        JsonElement request,
        IHttpTransport transport,
        Utf8JsonWriter writer
    )
    {
        string operation = request.GetProperty("operation").GetString()!;
        var handlers = new FeatureHandlers(
            request.TryGetProperty("scenario", out var scenario) ? scenario.GetString()! : "first"
        );
        var clock = TimeProvider.System;
        var diagnostics = new FeatureDeadlineDiagnostics();
        var deadline = Deadline.FromBudget(clock, TimeSpan.FromSeconds(30));
        var loopback = new LoopbackTransport(handlers, clock, diagnostics);
        bool useLoopback = !request.TryGetProperty("url", out var url);
        var origin = new Uri(useLoopback ? "http://loopback.invalid/" : url.GetString()!);
        var consumer = new EffectRuntime<IClientRequirements>(
            new FeatureClientRequirements(useLoopback ? loopback : transport, origin),
            clock,
            diagnostics
        );
        if (operation == "choose")
        {
            var input = Required(ChooseInput.Create());
            WriteExit(
                writer,
                await consumer.Run(
                    ContractClient.ChooseHttp(input),
                    deadline,
                    _ => new ChooseFailure.Communication(new("deadline")),
                    CancellationToken.None
                ),
                success =>
                {
                    _ = success switch
                    {
                        ChooseSuccess.First first => WriteChoice(
                            writer,
                            "First",
                            first.Value.Value
                        ),
                        ChooseSuccess.Second second => WriteChoice(
                            writer,
                            "Second",
                            second.Value.Value
                        ),
                        ChooseSuccess.Nil nil => WriteChoice(writer, "Nil", nil.Value),
                        ChooseSuccess.Done => WriteChoice(writer, "Done", null, false),
                    };
                },
                failure =>
                {
                    _ = failure switch
                    {
                        ChooseFailure.Declared declared => declared.Rejection switch
                        {
                            ChooseRejection.Refused refused => WriteChooseFailure(
                                writer,
                                "declared",
                                refused.Value.Reason
                            ),
                        },
                        ChooseFailure.Communication communication => WriteChooseFailure(
                            writer,
                            "transport",
                            communication.Failure.Reason
                        ),
                        ChooseFailure.InvalidInput invalid => WriteChooseFailure(
                            writer,
                            "input",
                            null,
                            invalid.Failure
                        ),
                    };
                }
            );
        }
        else if (operation == "route")
        {
            var payload = request.TryGetProperty("input", out var inputElement)
                ? inputElement.ValueKind == JsonValueKind.Null
                    ? Presence<Payload?>.Present(null)
                    : Presence<Payload?>.Present(
                        Required(Payload.Create(inputElement.GetProperty("value").GetString()!))
                    )
                : default;
            var search = request.TryGetProperty("search", out var searchElement)
                ? Presence<string>.Present(searchElement.GetString()!)
                : default;
            var input = Required(
                RouteInput.Create(
                    payload,
                    request.GetProperty("pathId").GetString()!,
                    search,
                    request.GetProperty("token").GetString()!
                )
            );
            WriteExit(
                writer,
                await consumer.Run(
                    ContractClient.RouteHttp(input),
                    deadline,
                    _ => new RouteFailure.Communication(new("deadline")),
                    CancellationToken.None
                ),
                success =>
                {
                    writer.WriteString("case", "Matched");
                    writer.WriteString("value", ((RouteSuccess.Matched)success).Value.Value);
                },
                failure =>
                    WriteFailure(
                        writer,
                        failure is RouteFailure.Communication communication
                            ? communication.Failure.Reason
                            : null,
                        failure is RouteFailure.InvalidInput invalid ? invalid.Failure : null
                    )
            );
        }
        else if (operation == "upload")
        {
            var input = Required(
                UploadInput.Create(
                    ImmutableArray.Create(
                        Convert.FromBase64String(request.GetProperty("bytes").GetString()!)
                    )
                )
            );
            WriteExit(
                writer,
                await consumer.Run(
                    ContractClient.UploadHttp(input),
                    deadline,
                    _ => new UploadFailure.Communication(new("deadline")),
                    CancellationToken.None
                ),
                success =>
                {
                    writer.WriteString("case", "Stored");
                    writer.WriteString("value", ((UploadSuccess.Stored)success).Value.Value);
                },
                failure =>
                    WriteFailure(
                        writer,
                        failure is UploadFailure.Communication communication
                            ? communication.Failure.Reason
                            : null,
                        failure is UploadFailure.InvalidInput invalid ? invalid.Failure : null
                    )
            );
        }
        else if (operation == "image")
        {
            WriteExit(
                writer,
                await consumer.Run(
                    ContractClient.ImageHttp(Required(ImageInput.Create())),
                    deadline,
                    _ => new ImageFailure.Communication(new("deadline")),
                    CancellationToken.None
                ),
                success =>
                {
                    writer.WriteString("case", "Loaded");
                    writer.WriteString(
                        "bytes",
                        Convert.ToBase64String(((ImageSuccess.Loaded)success).Value.AsSpan())
                    );
                },
                failure =>
                    WriteFailure(
                        writer,
                        failure is ImageFailure.Communication communication
                            ? communication.Failure.Reason
                            : null,
                        failure is ImageFailure.InvalidInput invalid ? invalid.Failure : null
                    )
            );
        }
        else if (operation == "ping")
        {
            WriteExit(
                writer,
                await consumer.Run(
                    ContractClient.PingHttp(Required(PingInput.Create())),
                    deadline,
                    _ => new PingFailure.Communication(new("deadline")),
                    CancellationToken.None
                ),
                success => writer.WriteString("case", "Pong"),
                failure =>
                    WriteFailure(
                        writer,
                        failure is PingFailure.Communication communication
                            ? communication.Failure.Reason
                            : null,
                        failure is PingFailure.InvalidInput invalid ? invalid.Failure : null
                    )
            );
        }
        else if (operation == "archive")
        {
            var input = Required(
                ArchiveInput.Create(
                    request.GetProperty("item").GetString()!,
                    request.GetProperty("tenant").GetString()!,
                    request.GetProperty("token").GetString()!
                )
            );
            WriteExit(
                writer,
                await consumer.Run(
                    ContractClient.ArchiveHttp(input),
                    deadline,
                    _ => new ArchiveFailure.Communication(new("deadline")),
                    CancellationToken.None
                ),
                success =>
                {
                    writer.WriteString("case", "Archived");
                    writer.WriteString("value", ((ArchiveSuccess.Archived)success).Value.Value);
                },
                failure =>
                    WriteFailure(
                        writer,
                        failure is ArchiveFailure.Communication communication
                            ? communication.Failure.Reason
                            : null,
                        failure is ArchiveFailure.InvalidInput invalid ? invalid.Failure : null
                    )
            );
        }
        else
            throw new InvalidOperationException("Unknown fixture operation");
        if (useLoopback)
        {
            writer.WritePropertyName("wire");
            writer.WriteRawValue(loopback.Wire);
            if (handlers.Seen is not null)
            {
                writer.WritePropertyName("handlerSaw");
                writer.WriteRawValue(handlers.Seen);
            }
        }
    }

    /// <summary>Typed generated outcome observation shared by every operation</summary>
    /// <typeparam name="TFailure">Operation failure family</typeparam>
    /// <typeparam name="TSuccess">Operation success family</typeparam>
    /// <param name="writer">Observation output</param>
    /// <param name="exit">Actual generated operation exit</param>
    /// <param name="success">Success classification</param>
    /// <param name="failure">Expected failure classification</param>
    private static void WriteExit<TFailure, TSuccess>(
        Utf8JsonWriter writer,
        EffectExit<TFailure, TSuccess> exit,
        Action<TSuccess> success,
        Action<TFailure> failure
    )
    {
        if (exit is EffectExit<TFailure, TSuccess>.Succeeded succeeded)
        {
            writer.WriteString("exit", "succeeded");
            success(succeeded.Value);
        }
        else if (exit is EffectExit<TFailure, TSuccess>.Failed failed)
            failure(failed.Failure);
        else if (exit is EffectExit<TFailure, TSuccess>.Defected defect)
        {
            writer.WriteString("exit", "defected");
            writer.WriteString("defect", defect.Exception.GetType().Name);
        }
        else
            writer.WriteString("exit", "canceled");
    }

    /// <summary>Transport or input failure observation for operations without declared rejections</summary>
    /// <param name="writer">Observation output</param>
    /// <param name="transport">Communication failure reason, if the failure was one</param>
    /// <param name="input">Positioned input failure, if the failure was one</param>
    private static void WriteFailure(
        Utf8JsonWriter writer,
        string? transport,
        ContractFailure? input
    )
    {
        if (transport is not null)
        {
            writer.WriteString("exit", "transport");
            writer.WriteString("reason", transport);
        }
        else if (input is not null)
        {
            writer.WriteString("exit", "input");
            Violations(writer, input);
        }
        else
            writer.WriteString("exit", "declared");
    }

    /// <summary>Hand-written native request dispatched straight into the generated provider</summary>
    /// <param name="request">Scenario with method, target, headers, media type and body</param>
    /// <param name="writer">Observation output</param>
    private static async Task RawProvider(JsonElement request, Utf8JsonWriter writer)
    {
        var handlers = new FeatureHandlers("first");
        using var message = new HttpRequestMessage(
            new HttpMethod(request.GetProperty("method").GetString()!),
            new Uri(new Uri("http://loopback.invalid/"), request.GetProperty("target").GetString()!)
        );
        if (request.TryGetProperty("headers", out var headers))
            foreach (var header in headers.EnumerateObject())
                message.Headers.TryAddWithoutValidation(
                    header.Name,
                    header.Value.EnumerateArray().Select(value => value.GetString()!)
                );
        if (request.TryGetProperty("body", out var body))
        {
            message.Content = new ByteArrayContent(Convert.FromBase64String(body.GetString()!));
            if (request.TryGetProperty("contentType", out var contentType))
                message.Content.Headers.TryAddWithoutValidation(
                    "Content-Type",
                    contentType.GetString()
                );
        }
        var clock = TimeProvider.System;
        var diagnostics = new FeatureDeadlineDiagnostics();
        var exit = await new EffectRuntime<IContractHandlers>(handlers, clock, diagnostics).Run(
            ContractProvider.DispatchHttp(message),
            Deadline.FromBudget(clock, TimeSpan.FromSeconds(30)),
            _ => new ProviderFailure.Choose(new ChooseFailure.Communication(new("deadline"))),
            CancellationToken.None
        );
        if (exit is EffectExit<ProviderFailure, HttpResponseMessage>.Succeeded succeeded)
        {
            using var response = succeeded.Value;
            writer.WriteString("exit", "responded");
            writer.WriteNumber("status", (int)response.StatusCode);
            writer.WriteString("contentType", response.Content?.Headers.ContentType?.MediaType);
            writer.WriteString(
                "bodyBase64",
                Convert.ToBase64String(
                    response.Content is null ? [] : await response.Content.ReadAsByteArrayAsync()
                )
            );
        }
        else if (exit is EffectExit<ProviderFailure, HttpResponseMessage>.Failed failed)
        {
            ContractFailure? input = failed.Failure switch
            {
                ProviderFailure.Route { Failure: RouteFailure.InvalidInput invalid } =>
                    invalid.Failure,
                ProviderFailure.Upload { Failure: UploadFailure.InvalidInput invalid } =>
                    invalid.Failure,
                ProviderFailure.Choose { Failure: ChooseFailure.InvalidInput invalid } =>
                    invalid.Failure,
                ProviderFailure.Image { Failure: ImageFailure.InvalidInput invalid } =>
                    invalid.Failure,
                ProviderFailure.Defaults { Failure: DefaultsFailure.InvalidInput invalid } =>
                    invalid.Failure,
                ProviderFailure.Merge { Failure: MergeFailure.InvalidInput invalid } =>
                    invalid.Failure,
                ProviderFailure.Ping { Failure: PingFailure.InvalidInput invalid } =>
                    invalid.Failure,
                ProviderFailure.Archive { Failure: ArchiveFailure.InvalidInput invalid } =>
                    invalid.Failure,
                ProviderFailure.Route
                {
                    Failure: RouteFailure.Declared or RouteFailure.Communication
                } => null,
                ProviderFailure.Upload
                {
                    Failure: UploadFailure.Declared or UploadFailure.Communication
                } => null,
                ProviderFailure.Choose
                {
                    Failure: ChooseFailure.Declared or ChooseFailure.Communication
                } => null,
                ProviderFailure.Image
                {
                    Failure: ImageFailure.Declared or ImageFailure.Communication
                } => null,
                ProviderFailure.Defaults
                {
                    Failure: DefaultsFailure.Declared or DefaultsFailure.Communication
                } => null,
                ProviderFailure.Merge
                {
                    Failure: MergeFailure.Declared or MergeFailure.Communication
                } => null,
                ProviderFailure.Ping
                {
                    Failure: PingFailure.Declared or PingFailure.Communication
                } => null,
                ProviderFailure.Archive
                {
                    Failure: ArchiveFailure.Declared or ArchiveFailure.Communication
                } => null,
                ProviderFailure.UnknownOperation => null,
            };
            if (input is not null)
            {
                writer.WriteString("exit", "input");
                Violations(writer, input);
            }
            else
                writer.WriteString(
                    "exit",
                    failed.Failure is ProviderFailure.UnknownOperation
                        ? "unknown-operation"
                        : "other"
                );
        }
        else
            writer.WriteString(
                "exit",
                exit is EffectExit<ProviderFailure, HttpResponseMessage>.Defected
                    ? "defected"
                    : "canceled"
            );
        if (handlers.Seen is not null)
        {
            writer.WritePropertyName("handlerSaw");
            writer.WriteRawValue(handlers.Seen);
        }
    }

    /// <summary>Fixture setup invariant extraction without validation duplication</summary>
    /// <typeparam name="T">Generated representation</typeparam>
    /// <param name="result">Actual generated factory result</param>
    /// <returns>Completed fixture value</returns>
    /// <exception cref="InvalidOperationException">Invalid fixture setup</exception>
    internal static T Required<T>(Result<Accepted<T>, ContractFailure> result) =>
        result.IsFailed(out _, out var accepted)
            ? throw new InvalidOperationException("Invalid fixture setup")
            : accepted.Value;
}

/// <summary>Handwritten adapter implementing only the generated handler contract</summary>
internal sealed class FeatureHandlers : IContractHandlers
{
    /// <summary>Selected choose outcome</summary>
    private readonly string _scenario;

    /// <summary>Handler-observed accepted input</summary>
    /// <value>JSON object text or null when no handler ran</value>
    public string? Seen { get; private set; }

    /// <summary>Adapter construction</summary>
    /// <param name="scenario">Selected choose outcome</param>
    public FeatureHandlers(string scenario)
    {
        _scenario = scenario;
    }

    /// <summary>Scenario-selected result with distinct same-status successes</summary>
    /// <param name="input">Generated input</param>
    /// <returns>Selected success or declared rejection</returns>
    public Effect<NoRequirements, ChooseRejection, ChooseSuccess> Choose(ChooseInput input)
    {
        var fx = new EffectContext<NoRequirements, ChooseRejection>();
        Seen = "{}";
        return _scenario switch
        {
            "first" => fx.Succeed(
                FeaturesDriver.Required(
                    ChooseSuccess.First.Create(FeaturesDriver.Required(Payload.Create("one")))
                )
            ),
            "second" => fx.Succeed(
                FeaturesDriver.Required(
                    ChooseSuccess.Second.Create(FeaturesDriver.Required(Payload.Create("two")))
                )
            ),
            "nil" => fx.Succeed(FeaturesDriver.Required(ChooseSuccess.Nil.Create(null))),
            "done" => fx.Succeed(FeaturesDriver.Required(ChooseSuccess.Done.Create())),
            "refused" => fx.Fail<ChooseSuccess>(
                FeaturesDriver.Required(
                    ChooseRejection.Refused.Create(
                        FeaturesDriver.Required(Refused.Create("blocked"))
                    )
                )
            ),
            _ => throw new InvalidOperationException("Unknown fixture scenario"),
        };
    }

    /// <summary>Fixed binary result</summary>
    /// <param name="input">Generated input</param>
    /// <returns>PNG signature bytes</returns>
    public Effect<NoRequirements, ImageRejection, ImageSuccess> Image(ImageInput input)
    {
        Seen = "{}";
        return new EffectContext<NoRequirements, ImageRejection>().Succeed(
            FeaturesDriver.Required(
                ImageSuccess.Loaded.Create(ImmutableArray.Create<byte>(0x89, 0x50, 0x4E, 0x47))
            )
        );
    }

    /// <summary>Echo of every effective input member so provider extraction is observable</summary>
    /// <param name="input">Provider-accepted input with the applied default</param>
    /// <returns>Fixed matched payload</returns>
    public Effect<NoRequirements, RouteRejection, RouteSuccess> Route(RouteAcceptedInput input)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("pathId", input.PathId);
            writer.WriteString("token", input.Token);
            writer.WriteString("search", input.Search);
            if (!input.Input.IsPresent)
                writer.WriteString("input", "absent");
            else if (input.Input.Value is null)
                writer.WriteNull("input");
            else
                writer.WriteString("input", input.Input.Value.Value);
            writer.WriteEndObject();
        }
        Seen = Encoding.UTF8.GetString(stream.ToArray());
        return new EffectContext<NoRequirements, RouteRejection>().Succeed(
            FeaturesDriver.Required(
                RouteSuccess.Matched.Create(FeaturesDriver.Required(Payload.Create("matched")))
            )
        );
    }

    /// <summary>Echo of the exact received bytes</summary>
    /// <param name="input">Generated accepted input</param>
    /// <returns>Fixed stored payload</returns>
    public Effect<NoRequirements, UploadRejection, UploadSuccess> Upload(UploadInput input)
    {
        Seen = "{\"bytes\":\"" + Convert.ToBase64String(input.Binary.AsSpan()) + "\"}";
        return new EffectContext<NoRequirements, UploadRejection>().Succeed(
            FeaturesDriver.Required(
                UploadSuccess.Stored.Create(FeaturesDriver.Required(Payload.Create("stored")))
            )
        );
    }

    /// <summary>Echo of the effective branch that provider acceptance produced</summary>
    /// <param name="input">Provider-accepted input with defaults applied below every omitted member</param>
    /// <returns>Fixed seen payload</returns>
    public Effect<NoRequirements, DefaultsRejection, DefaultsSuccess> Defaults(DefaultsInput input)
    {
        Seen = FeaturesDriver.Describe(input.Branch);
        return new EffectContext<NoRequirements, DefaultsRejection>().Succeed(
            FeaturesDriver.Required(
                DefaultsSuccess.Seen.Create(FeaturesDriver.Required(Payload.Create("seen")))
            )
        );
    }

    /// <summary>Echo of the identifier and label that the handler received</summary>
    /// <param name="input">Provider-accepted input</param>
    /// <returns>Fixed done payload</returns>
    public Effect<NoRequirements, MergeRejection, MergeSuccess> Merge(MergeInput input)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("id", input.Id);
            writer.WriteString("label", input.Label);
            writer.WriteEndObject();
        }
        Seen = Encoding.UTF8.GetString(stream.ToArray());
        return new EffectContext<NoRequirements, MergeRejection>().Succeed(
            FeaturesDriver.Required(
                MergeSuccess.Done.Create(FeaturesDriver.Required(Payload.Create("done")))
            )
        );
    }

    /// <summary>Void result of the bodyless selection scenarios</summary>
    /// <param name="input">Generated input</param>
    /// <returns>Body-free success</returns>
    public Effect<NoRequirements, PingRejection, PingSuccess> Ping(PingInput input)
    {
        Seen = "{}";
        return new EffectContext<NoRequirements, PingRejection>().Succeed(
            FeaturesDriver.Required(PingSuccess.Pong.Create())
        );
    }

    /// <summary>Echo of the path and header values that the provider extracted</summary>
    /// <param name="input">Provider-accepted input</param>
    /// <returns>Fixed archived payload</returns>
    public Effect<NoRequirements, ArchiveRejection, ArchiveSuccess> Archive(ArchiveInput input)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("tenant", input.Tenant);
            writer.WriteString("item", input.Item);
            writer.WriteString("token", input.Token);
            writer.WriteEndObject();
        }
        Seen = Encoding.UTF8.GetString(stream.ToArray());
        return new EffectContext<NoRequirements, ArchiveRejection>().Succeed(
            FeaturesDriver.Required(
                ArchiveSuccess.Archived.Create(FeaturesDriver.Required(Payload.Create("archived")))
            )
        );
    }
}

/// <summary>In-memory transport between the generated client and the generated provider that records both messages</summary>
internal sealed class LoopbackTransport : IHttpTransport
{
    /// <summary>Provider adapter</summary>
    private readonly FeatureHandlers _handlers;

    /// <summary>Host-owned clock shared with the consumer boundary</summary>
    private readonly TimeProvider _clock;

    /// <summary>Host-owned deadline observation collector</summary>
    private readonly FeatureDeadlineDiagnostics _diagnostics;

    /// <summary>Recorded request and response as one JSON object</summary>
    /// <value>JSON object text</value>
    public string Wire { get; private set; } = "{}";

    /// <summary>Loopback construction</summary>
    /// <param name="handlers">Handwritten provider adapter</param>
    /// <param name="clock">Host-owned runtime clock</param>
    /// <param name="diagnostics">Host-owned deadline observation collector</param>
    public LoopbackTransport(
        FeatureHandlers handlers,
        TimeProvider clock,
        FeatureDeadlineDiagnostics diagnostics
    )
    {
        _handlers = handlers;
        _clock = clock;
        _diagnostics = diagnostics;
    }

    /// <summary>Dispatch of the generated client's request into the generated provider</summary>
    /// <param name="request">Generated native request</param>
    /// <param name="cancellationToken">Host cancellation</param>
    /// <returns>Provider response or a host failure representation</returns>
    public async ValueTask<HttpResponseMessage> Send(
        HttpRequestMessage request,
        CancellationToken cancellationToken
    )
    {
        byte[] requestBody = request.Content is null
            ? []
            : await request.Content.ReadAsByteArrayAsync(cancellationToken);
        if (!request.Options.TryGetValue(ContractClient.DeadlineOption, out var deadline))
            throw new InvalidOperationException("Missing runtime deadline");
        var exit = await new EffectRuntime<IContractHandlers>(_handlers, _clock, _diagnostics).Run(
            ContractProvider.DispatchHttp(request),
            deadline,
            _ => new ProviderFailure.Choose(new ChooseFailure.Communication(new("deadline"))),
            cancellationToken
        );
        var response = exit is EffectExit<ProviderFailure, HttpResponseMessage>.Succeeded succeeded
            ? succeeded.Value
            : new HttpResponseMessage(HttpStatusCode.InternalServerError);
        byte[] responseBody = response.Content is null
            ? []
            : await response.Content.ReadAsByteArrayAsync(cancellationToken);
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteStartObject("request");
            writer.WriteString("method", request.Method.Method);
            writer.WriteString("origin", request.RequestUri!.GetLeftPart(UriPartial.Authority));
            writer.WriteString("target", request.RequestUri!.PathAndQuery);
            if (request.Headers.TryGetValues("X-Token", out var token))
                writer.WriteString("token", string.Join(",", token));
            writer.WriteString("contentType", request.Content?.Headers.ContentType?.ToString());
            writer.WriteString("bodyBase64", Convert.ToBase64String(requestBody));
            writer.WriteEndObject();
            writer.WriteStartObject("response");
            writer.WriteNumber("status", (int)response.StatusCode);
            if (response.Headers.TryGetValues("x-case", out var selector))
                writer.WriteString("xcase", string.Join(",", selector));
            writer.WriteString("contentType", response.Content?.Headers.ContentType?.ToString());
            writer.WriteString("bodyBase64", Convert.ToBase64String(responseBody));
            writer.WriteEndObject();
            writer.WriteEndObject();
        }
        Wire = Encoding.UTF8.GetString(stream.ToArray());
        return response;
    }
}

/// <summary>Caller-owned concrete generated client requirements</summary>
internal sealed class FeatureClientRequirements : IClientRequirements
{
    /// <summary>Injected native HTTP transport</summary>
    /// <value>Caller-owned connection</value>
    public IHttpTransport Http { get; }

    /// <summary>Injected service origin</summary>
    /// <value>Absolute origin</value>
    public Uri ServiceOrigin { get; }

    /// <summary>IPC transport that the features scenarios never select</summary>
    /// <value>Transport reporting a communication failure when invoked</value>
    public IIpcTransport Ipc { get; } = new UnselectedTransport();

    /// <summary>Client capability construction</summary>
    /// <param name="http">Caller-owned native transport</param>
    /// <param name="origin">Service origin</param>
    internal FeatureClientRequirements(IHttpTransport http, Uri origin)
    {
        Http = http;
        ServiceOrigin = origin;
    }
}

/// <summary>IPC transport for scenarios that exercise only HTTP bindings</summary>
internal sealed class UnselectedTransport : IIpcTransport
{
    /// <summary>Invocation reporting that no IPC peer exists for these scenarios</summary>
    /// <param name="command">Generated command name</param>
    /// <param name="parameters">Generated JSON parameters object</param>
    /// <param name="deadline">Forwarded host deadline</param>
    /// <param name="cancellationToken">Runtime-owned cancellation notification</param>
    /// <returns>Expected communication failure</returns>
    public ValueTask<Result<string, CommunicationFailure>> Invoke(
        string command,
        string parameters,
        Deadline deadline,
        CancellationToken cancellationToken
    ) => new(Result.Failed<CommunicationFailure>(new CommunicationFailure("ipc-not-selected")));
}

/// <summary>Concrete collection of feature runtime deadline overruns</summary>
internal sealed class FeatureDeadlineDiagnostics : IDeadlineDiagnostics
{
    /// <summary>Recorded deadline observations</summary>
    /// <value>Absolute deadlines paired with their observed overruns</value>
    public List<(Deadline Deadline, TimeSpan Overrun)> Overruns { get; } = [];

    /// <summary>Retention of a runtime deadline observation</summary>
    /// <param name="deadline">Original execution deadline</param>
    /// <param name="overrun">Observed positive overrun</param>
    public void RecordOverrun(Deadline deadline, TimeSpan overrun) =>
        Overruns.Add((deadline, overrun));
}
