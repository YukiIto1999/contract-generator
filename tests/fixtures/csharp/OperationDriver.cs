using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using EffectSystem.Domain;
using Sample;
using Sample.Client;
using Sample.Provider;
using TypeModeling.Domain;

/// <summary>Real native HTTP and separate-process IPC fixture host</summary>
internal static class OperationDriver
{
    /// <summary>Fixture mode selection</summary>
    /// <param name="args">Explicit server or worker mode</param>
    /// <returns>Process exit code</returns>
    public static async Task<int> Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--ipc-worker")
            return await Worker(args.Length == 3 && args[1] == "--ipc-peer" ? args[2] : null);
        if (args.Length == 2 && args[0] == "--http-server")
            return await Server(args[1]);
        using var transport = new SocketsHttpTransport();
        var recorder = new DeadlineRecorder(transport);
        string? line;
        while ((line = await Console.In.ReadLineAsync()) is not null)
        {
            using var request = JsonDocument.Parse(line);
            Console.WriteLine(await Observe(request.RootElement, recorder));
        }
        return 0;
    }

    /// <summary>Generated provider execution in a distinct process</summary>
    /// <param name="peerFault">Optional hand-authored peer behavior replacing the generated provider</param>
    /// <returns>Process success or explicit peer failure code</returns>
    private static async Task<int> Worker(string? peerFault)
    {
        string? line;
        var clock = TimeProvider.System;
        var diagnostics = new OperationDeadlineDiagnostics();
        var runtime = new EffectRuntime<IContractHandlers>(
            new FixtureHandlers(),
            clock,
            diagnostics
        );
        while ((line = await Console.In.ReadLineAsync()) is not null)
        {
            if (peerFault is not null)
                return PeerFault(peerFault);
            using var request = JsonDocument.Parse(line);
            var root = request.RootElement;
            var deadline = root.TryGetProperty("deadline", out var at)
                ? new Deadline(at.GetDateTimeOffset())
                : Deadline.FromBudget(clock, TimeSpan.FromSeconds(30));
            var exit = await runtime.Run(
                ContractProvider.DispatchIpc(
                    root.GetProperty("command").GetString()!,
                    root.GetProperty("parameters").GetString()!
                ),
                deadline,
                _ => new ProviderFailure.Submit(new SubmitFailure.Communication(new("deadline"))),
                CancellationToken.None
            );
            if (exit is not EffectExit<ProviderFailure, string>.Succeeded response)
            {
                Console.Error.WriteLine(Describe(Classify(exit)));
                return 2;
            }
            Console.WriteLine(response.Value);
        }
        return 0;
    }

    /// <summary>Hand-authored wire behavior of a misbehaving or independent IPC peer</summary>
    /// <param name="kind">Selected peer behavior</param>
    /// <returns>Process success code after the scripted bytes</returns>
    /// <exception cref="InvalidOperationException">Unknown fixture peer behavior</exception>
    private static int PeerFault(string kind)
    {
        switch (kind)
        {
            case "eof":
                break;
            case "garbage":
                Console.Out.Write("not-json\n");
                break;
            case "truncated":
                Console.Out.Write("{\"tag\":\"created\",\"bo");
                break;
            case "unknown-tag":
                Console.Out.Write("{\"tag\":\"mystery\",\"body\":{}}\n");
                break;
            case "void-with-body":
                Console.Out.Write("{\"tag\":\"completed\",\"body\":null}\n");
                break;
            case "missing-body":
                Console.Out.Write("{\"tag\":\"created\"}\n");
                break;
            case "wrong-body":
                Console.Out.Write("{\"tag\":\"created\",\"body\":{\"value\":1}}\n");
                break;
            case "queued":
                Console.Out.Write("{\"tag\":\"queued\",\"body\":{\"value\":\"wire\"}}\n");
                break;
            case "completed":
                Console.Out.Write("{\"tag\":\"completed\"}\n");
                break;
            case "rejected":
                Console.Out.Write(
                    "{\"tag\":\"rejected\",\"body\":{\"code\":\"invalid\",\"message\":\"wire\"}}\n"
                );
                break;
            case "downloaded":
                Console.Out.Write("{\"tag\":\"downloaded\",\"body\":\"AP8=\"}\n");
                break;
            default:
                throw new InvalidOperationException("Unknown fixture peer behavior");
        }
        Console.Out.Flush();
        return 0;
    }

    /// <summary>Real loopback HTTP listener connected to generated dispatch</summary>
    /// <param name="prefix">Explicit host-owned listener address</param>
    /// <returns>Host exit code</returns>
    private static async Task<int> Server(string prefix)
    {
        using var listener = new HttpListener();
        listener.Prefixes.Add(prefix);
        listener.Start();
        Console.WriteLine("ready");
        var clock = TimeProvider.System;
        var diagnostics = new OperationDeadlineDiagnostics();
        var runtime = new EffectRuntime<IContractHandlers>(
            new FixtureHandlers(),
            clock,
            diagnostics
        );
        while (listener.IsListening)
        {
            var context = await listener.GetContextAsync();
            using var request = new HttpRequestMessage(
                new HttpMethod(context.Request.HttpMethod),
                context.Request.Url
            );
            if (context.Request.HasEntityBody || context.Request.ContentType is not null)
            {
                using var body = new MemoryStream();
                await context.Request.InputStream.CopyToAsync(body);
                request.Content = new ByteArrayContent(body.ToArray());
                if (context.Request.ContentType is string media)
                    request.Content.Headers.TryAddWithoutValidation("Content-Type", media);
            }
            foreach (
                string key in context
                    .Request.Headers.AllKeys.OfType<string>()
                    .Where(key =>
                        !key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)
                        && !key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)
                    )
            )
            {
                string[] values = context.Request.Headers.GetValues(key) ?? [];
                if (!request.Headers.TryAddWithoutValidation(key, values))
                    request.Content?.Headers.TryAddWithoutValidation(key, values);
            }
            var exit = await runtime.Run(
                ContractProvider.DispatchHttp(request),
                Deadline.FromBudget(clock, TimeSpan.FromSeconds(30)),
                _ => new ProviderFailure.Submit(new SubmitFailure.Communication(new("deadline"))),
                CancellationToken.None
            );
            if (exit is EffectExit<ProviderFailure, HttpResponseMessage>.Succeeded succeeded)
            {
                using var response = succeeded.Value;
                context.Response.StatusCode = (int)response.StatusCode;
                foreach (var header in response.Headers)
                    context.Response.Headers[header.Key] = string.Join(",", header.Value);
                if (response.Content.Headers.ContentType is not null)
                    context.Response.ContentType = response.Content.Headers.ContentType.ToString();
                foreach (var header in response.Content.Headers)
                    if (
                        !header.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)
                        && !header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)
                    )
                        context.Response.Headers[header.Key] = string.Join(",", header.Value);
                byte[] bytes = await response.Content.ReadAsByteArrayAsync();
                context.Response.ContentLength64 = bytes.Length;
                if (bytes.Length > 0)
                    await context.Response.OutputStream.WriteAsync(bytes);
            }
            else
                await WriteFailure(context.Response, Classify(exit));
            context.Response.Close();
        }
        return 0;
    }

    /// <summary>One generated client or direct-provider observation</summary>
    /// <param name="request">Driver scenario</param>
    /// <param name="recorder">Injected HTTP transport that observes generated request metadata before the native exchange</param>
    /// <returns>JSON result observation</returns>
    private static async Task<string> Observe(JsonElement request, DeadlineRecorder recorder)
    {
        string operation = request.TryGetProperty("operation", out var o)
            ? o.GetString()!
            : "submit";
        string binding = request.TryGetProperty("binding", out var b) ? b.GetString()! : "direct";
        string payload = request.TryGetProperty("payload", out var p) ? p.GetString()! : "{}";
        var origin = new Uri(
            request.TryGetProperty("url", out var url) ? url.GetString()! : "http://127.0.0.1:1/"
        );
        var clock = TimeProvider.System;
        var diagnostics = new OperationDeadlineDiagnostics();
        var deadline = request.TryGetProperty("deadline", out var d)
            ? new Deadline(d.GetDateTimeOffset())
            : Deadline.FromBudget(
                clock,
                request.TryGetProperty("deadlineAfterMs", out var after)
                    ? TimeSpan.FromMilliseconds(after.GetInt32())
                    : TimeSpan.FromSeconds(30)
            );
        using var parent = new CancellationTokenSource();
        string cancellation = request.TryGetProperty("cancel", out var cancel)
            ? cancel.GetString()!
            : "none";
        if (cancellation == "before")
            parent.Cancel();
        if (request.TryGetProperty("cancelAfterMs", out var milliseconds))
            parent.CancelAfter(milliseconds.GetInt32());
        string? peer = request.TryGetProperty("ipcPeer", out var ipcPeer)
            ? ipcPeer.GetString()
            : null;
        var consumer = new EffectRuntime<IClientRequirements>(
            new FixtureClientRequirements(recorder, origin, peer),
            clock,
            diagnostics
        );
        recorder.Reset();
        var provider = new EffectRuntime<IContractHandlers>(
            new FixtureHandlers(),
            clock,
            diagnostics
        );
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            if (operation == "submit")
            {
                var input = SubmitInputCodec.Decode(payload, binding == "ipc" ? "ipc" : "http");
                if (input.IsFailed(out var invalid, out var accepted))
                    InputFailure(writer, invalid.Failure);
                else
                {
                    var value = accepted.Value;
                    var exit =
                        binding == "direct"
                            ? await provider.Run(
                                ContractProvider.Submit(value),
                                deadline,
                                _ => new SubmitFailure.Communication(new("deadline")),
                                parent.Token
                            )
                            : await consumer.Run(
                                binding == "ipc"
                                    ? ContractClient.SubmitIpc(value)
                                    : ContractClient.SubmitHttp(value),
                                deadline,
                                _ => new SubmitFailure.Communication(new("deadline")),
                                parent.Token
                            );
                    if (cancellation == "after")
                        parent.Cancel();
                    SubmitExit(writer, exit, parent.IsCancellationRequested);
                }
            }
            else if (operation == "download")
            {
                var input = DownloadInputCodec.Decode(payload, binding == "ipc" ? "ipc" : "http");
                if (input.IsFailed(out var invalid, out var accepted))
                    InputFailure(writer, invalid.Failure);
                else
                {
                    var value = accepted.Value;
                    var exit =
                        binding == "direct"
                            ? await provider.Run(
                                ContractProvider.Download(value),
                                deadline,
                                _ => new DownloadFailure.Communication(new("deadline")),
                                parent.Token
                            )
                            : await consumer.Run(
                                binding == "ipc"
                                    ? ContractClient.DownloadIpc(value)
                                    : ContractClient.DownloadHttp(value),
                                deadline,
                                _ => new DownloadFailure.Communication(new("deadline")),
                                parent.Token
                            );
                    if (cancellation == "after")
                        parent.Cancel();
                    DownloadExit(writer, exit, parent.IsCancellationRequested);
                }
            }
            else
                throw new InvalidOperationException("Unknown fixture operation");
            if (request.TryGetProperty("observeDeadline", out var observe) && observe.GetBoolean())
            {
                if (binding == "http" && recorder.Seen)
                    writer.WriteString(
                        "httpDeadline",
                        recorder.Deadline.At.UtcDateTime.ToString("O", CultureInfo.InvariantCulture)
                    );
                writer.WriteString(
                    "runtimeDeadline",
                    deadline.At.UtcDateTime.ToString("O", CultureInfo.InvariantCulture)
                );
                writer.WriteNumber("deadlineOverruns", diagnostics.Overruns.Count);
            }
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>Typed submission result observation</summary>
    /// <param name="writer">Observation output</param>
    /// <param name="exit">Actual generated operation exit</param>
    /// <param name="parentCanceled">Host parent cancellation state</param>
    private static void SubmitExit(
        Utf8JsonWriter writer,
        EffectExit<SubmitFailure, SubmitSuccess> exit,
        bool parentCanceled
    )
    {
        if (exit is EffectExit<SubmitFailure, SubmitSuccess>.Succeeded success)
        {
            writer.WriteString("exit", "succeeded");
            if (success.Value is SubmitSuccess.Created created)
            {
                writer.WriteString("case", "Created");
                writer.WriteString("value", created.Value.Value);
            }
            else if (success.Value is SubmitSuccess.Queued queued)
            {
                writer.WriteString("case", "Queued");
                writer.WriteString("value", queued.Value.Value);
            }
            else if (success.Value is SubmitSuccess.Completed)
                writer.WriteString("case", "Completed");
            else
                throw new InvalidOperationException("Invalid generated success");
        }
        else if (exit is EffectExit<SubmitFailure, SubmitSuccess>.Failed failed)
        {
            if (failed.Failure is SubmitFailure.InvalidInput invalid)
                InputFailure(writer, invalid.Failure);
            else if (failed.Failure is SubmitFailure.Declared declared)
            {
                writer.WriteString("exit", "declared");
                if (declared.Rejection is SubmitRejection.Rejected rejection)
                    writer.WriteString("code", rejection.Value.Code);
                else
                    throw new InvalidOperationException("Invalid generated rejection");
            }
            else if (failed.Failure is SubmitFailure.Communication communication)
            {
                writer.WriteString("exit", "transport");
                writer.WriteString("reason", communication.Failure.Reason);
            }
            else
                throw new InvalidOperationException("Invalid generated failure");
        }
        else if (exit is EffectExit<SubmitFailure, SubmitSuccess>.Defected defect)
        {
            writer.WriteString("exit", "defected");
            writer.WriteString("defect", defect.Exception.GetType().Name);
        }
        else
        {
            writer.WriteString("exit", "canceled");
            writer.WriteString("reason", parentCanceled ? "parent" : "transport");
        }
    }

    /// <summary>Typed binary result observation</summary>
    /// <param name="writer">Observation output</param>
    /// <param name="exit">Actual generated operation exit</param>
    /// <param name="parentCanceled">Host parent cancellation state</param>
    private static void DownloadExit(
        Utf8JsonWriter writer,
        EffectExit<DownloadFailure, DownloadSuccess> exit,
        bool parentCanceled
    )
    {
        if (
            exit is EffectExit<DownloadFailure, DownloadSuccess>.Succeeded success
            && success.Value is DownloadSuccess.Downloaded downloaded
        )
        {
            writer.WriteString("exit", "succeeded");
            writer.WriteString("case", "Downloaded");
            writer.WriteString("bytes", Convert.ToBase64String(downloaded.Value.AsSpan()));
        }
        else if (exit is EffectExit<DownloadFailure, DownloadSuccess>.Failed failed)
        {
            if (failed.Failure is DownloadFailure.InvalidInput invalid)
                InputFailure(writer, invalid.Failure);
            else if (failed.Failure is DownloadFailure.Declared)
                writer.WriteString("exit", "declared");
            else if (failed.Failure is DownloadFailure.Communication communication)
            {
                writer.WriteString("exit", "transport");
                writer.WriteString("reason", communication.Failure.Reason);
            }
            else
                throw new InvalidOperationException("Invalid generated failure");
        }
        else if (exit is EffectExit<DownloadFailure, DownloadSuccess>.Defected defect)
        {
            writer.WriteString("exit", "defected");
            writer.WriteString("defect", defect.Exception.GetType().Name);
        }
        else
        {
            writer.WriteString("exit", "canceled");
            writer.WriteString("reason", parentCanceled ? "parent" : "transport");
        }
    }

    /// <summary>Positioned generated input failure observation</summary>
    /// <param name="writer">Observation output</param>
    /// <param name="failure">Actual generated input failure</param>
    private static void InputFailure(Utf8JsonWriter writer, ContractFailure failure)
    {
        writer.WriteString("exit", "input");
        Violations(writer, failure);
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

    /// <summary>Host classification of a generated provider failure</summary>
    /// <typeparam name="T">Provider success representation</typeparam>
    /// <param name="exit">Actual provider exit</param>
    /// <returns>Host-owned failure kind and positioned input violations</returns>
    private static HostFailure Classify<T>(EffectExit<ProviderFailure, T> exit)
    {
        if (exit is EffectExit<ProviderFailure, T>.Failed failed)
        {
            ContractFailure? input = failed.Failure switch
            {
                ProviderFailure.Submit { Failure: SubmitFailure.InvalidInput invalid } =>
                    invalid.Failure,
                ProviderFailure.Download { Failure: DownloadFailure.InvalidInput invalid } =>
                    invalid.Failure,
                ProviderFailure.Submit
                {
                    Failure: SubmitFailure.Declared or SubmitFailure.Communication
                } => null,
                ProviderFailure.Download
                {
                    Failure: DownloadFailure.Declared or DownloadFailure.Communication
                } => null,
                ProviderFailure.UnknownOperation => null,
            };
            if (input is not null)
                return new HostFailure("input", input);
            return new HostFailure(
                failed.Failure is ProviderFailure.UnknownOperation ? "unknown-operation" : "other",
                null
            );
        }
        return new HostFailure(
            exit is EffectExit<ProviderFailure, T>.Defected ? "defect" : "canceled",
            null
        );
    }

    /// <summary>Host diagnostic encoding of a classified provider failure</summary>
    /// <param name="failure">Host failure classification</param>
    /// <returns>JSON object without request values</returns>
    private static string Describe(HostFailure failure)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("failure", failure.Kind);
            if (failure.Input is not null)
                Violations(writer, failure.Input);
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>Host HTTP representation of a provider failure outside the declared outcomes</summary>
    /// <param name="response">Native listener response</param>
    /// <param name="failure">Host failure classification</param>
    /// <returns>Completion after the response bytes are written</returns>
    private static async Task WriteFailure(HttpListenerResponse response, HostFailure failure)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(Describe(failure));
        response.StatusCode = failure.Kind switch
        {
            "input" => 400,
            "unknown-operation" => 404,
            _ => 500,
        };
        response.ContentType = "application/problem+json";
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes);
    }
}

/// <summary>Host-owned provider failure classification</summary>
/// <param name="Kind">Stable failure kind</param>
/// <param name="Input">Positioned input violations when the generated provider rejected input</param>
internal sealed record HostFailure(string Kind, ContractFailure? Input);

/// <summary>HTTP transport observing generated deadline metadata on the real request</summary>
internal sealed class DeadlineRecorder : IHttpTransport
{
    /// <summary>Native transport that performs the exchange</summary>
    private readonly IHttpTransport _inner;

    /// <summary>Metadata observation marker</summary>
    /// <value>The last request carried the generated deadline option</value>
    public bool Seen { get; private set; }

    /// <summary>Observed host deadline</summary>
    /// <value>Absolute deadline forwarded by the generated client</value>
    public Deadline Deadline { get; private set; }

    /// <summary>Recorder construction over the native transport</summary>
    /// <param name="inner">Native transport that follows no redirect</param>
    public DeadlineRecorder(IHttpTransport inner)
    {
        _inner = inner;
    }

    /// <summary>Observation reset before one scenario</summary>
    public void Reset()
    {
        Seen = false;
        Deadline = default;
    }

    /// <summary>Metadata observation before real network communication</summary>
    /// <param name="request">Generated native request</param>
    /// <param name="cancellationToken">Host cancellation</param>
    /// <returns>Native response</returns>
    public ValueTask<HttpResponseMessage> Send(
        HttpRequestMessage request,
        CancellationToken cancellationToken
    )
    {
        Seen = request.Options.TryGetValue(ContractClient.DeadlineOption, out var deadline);
        Deadline = deadline;
        return _inner.Send(request, cancellationToken);
    }
}

/// <summary>Concrete collection of fixture runtime deadline overruns</summary>
internal sealed class OperationDeadlineDiagnostics : IDeadlineDiagnostics
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
