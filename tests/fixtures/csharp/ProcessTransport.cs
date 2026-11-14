using System.ComponentModel;
using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using EffectSystem.Domain;
using Sample;
using Sample.Client;
using TypeModeling.Domain;

/// <summary>Actual separate-process JSON-lines transport</summary>
internal sealed class ProcessTransport : IIpcTransport
{
    /// <summary>Optional scripted peer behavior replacing the generated provider in the child</summary>
    private readonly string? _peer;

    /// <summary>Transport construction</summary>
    /// <param name="peer">Optional hand-authored peer behavior</param>
    internal ProcessTransport(string? peer)
    {
        _peer = peer;
    }

    /// <summary>Native process invocation with host-owned cancellation</summary>
    /// <param name="command">Generated command name</param>
    /// <param name="parameters">Generated JSON parameters object</param>
    /// <param name="deadline">Forwarded host deadline</param>
    /// <param name="token">Runtime-owned cancellation notification</param>
    /// <returns>Resolved generated envelope or communication failure</returns>
    public async ValueTask<Result<string, CommunicationFailure>> Invoke(
        string command,
        string parameters,
        Deadline deadline,
        CancellationToken token
    )
    {
        try
        {
            token.ThrowIfCancellationRequested();
            var start = new ProcessStartInfo("dotnet")
            {
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
            start.ArgumentList.Add("--ipc-worker");
            if (_peer is not null)
            {
                start.ArgumentList.Add("--ipc-peer");
                start.ArgumentList.Add(_peer);
            }
            using var child =
                Process.Start(start) ?? throw new IOException("Unable to start IPC peer");
            Task<string>? diagnostics = null;
            try
            {
                diagnostics = child.StandardError.ReadToEndAsync();
                using var stream = new MemoryStream();
                using (var writer = new Utf8JsonWriter(stream))
                {
                    writer.WriteStartObject();
                    writer.WriteString("command", command);
                    writer.WriteString("parameters", parameters);
                    writer.WriteString("deadline", deadline.At);
                    writer.WriteEndObject();
                }
                await child.StandardInput.WriteLineAsync(
                    Encoding.UTF8.GetString(stream.ToArray()).AsMemory(),
                    token
                );
                child.StandardInput.Close();
                string output = await child.StandardOutput.ReadToEndAsync(token);
                if (!output.EndsWith('\n'))
                    throw new EndOfStreamException(
                        "IPC peer closed before a complete response line"
                    );
                string line = output[..^1];
                if (line.EndsWith('\r'))
                    line = line[..^1];
                if (line.Contains('\n'))
                    throw new IOException("IPC peer wrote more than one response line");
                return Result.Succeeded(line);
            }
            finally
            {
                if (!child.HasExited)
                    child.Kill(entireProcessTree: true);
                await child.WaitForExitAsync(CancellationToken.None);
                if (diagnostics is not null)
                    await diagnostics;
            }
        }
        catch (Exception exception) when (exception is IOException or Win32Exception)
        {
            return Result.Failed(new CommunicationFailure("ipc-communication"));
        }
    }
}

/// <summary>Caller-owned concrete generated client requirements</summary>
internal sealed class FixtureClientRequirements : IClientRequirements
{
    /// <summary>Injected native HTTP transport</summary>
    /// <value>Caller-owned connection</value>
    public IHttpTransport Http { get; }

    /// <summary>Injected service origin</summary>
    /// <value>Absolute listener origin</value>
    public Uri ServiceOrigin { get; }

    /// <summary>Injected separate-process transport</summary>
    /// <value>Native process transport</value>
    public IIpcTransport Ipc { get; }

    /// <summary>Client capability construction</summary>
    /// <param name="http">Caller-owned native transport</param>
    /// <param name="origin">Service origin</param>
    /// <param name="peer">Optional hand-authored IPC peer behavior</param>
    internal FixtureClientRequirements(IHttpTransport http, Uri origin, string? peer)
    {
        Http = http;
        ServiceOrigin = origin;
        Ipc = new ProcessTransport(peer);
    }
}
