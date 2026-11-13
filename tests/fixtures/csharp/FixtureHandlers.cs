using System.Collections.Immutable;
using EffectSystem.Domain;
using Sample;
using Sample.Provider;
using TypeModeling.Domain;

/// <summary>Handwritten fixture adapter implementing only the generated handler contract</summary>
internal sealed class FixtureHandlers : IContractHandlers
{
    /// <summary>Observed provider defaults with independently selected fixture outcomes</summary>
    /// <param name="input">Generated effective input</param>
    /// <returns>Count-selected success or explicit rejection</returns>
    public Effect<NoRequirements, SubmitRejection, SubmitSuccess> Submit(SubmitAcceptedInput input)
    {
        var fx = new EffectContext<NoRequirements, SubmitRejection>();
        if (input.Input.Label == "rej")
        {
            var payload = Required(Rejected.Create(code: "invalid", message: "fixture rejection"));
            return fx.Fail<SubmitSuccess>(Required(SubmitRejection.Rejected.Create(payload)));
        }
        if (input.Input.Label == "dl")
        {
            return fx.Try<SubmitSuccess>((_, deadline, token) =>
            {
                var observed = Required(Receipt.Create(value: "deadline:" + deadline.At.UtcDateTime.ToString("O", System.Globalization.CultureInfo.InvariantCulture)));
                return new ValueTask<SubmitSuccess>(Required(SubmitSuccess.Created.Create(observed)));
            }, exception => throw exception);
        }
        if (input.Input.Label == "pid")
            return fx.Succeed(Required(SubmitSuccess.Created.Create(Required(Receipt.Create(value: "pid:" + Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture))))));
        if (input.Input.Label == "zzz")
            return fx.Try(async (_, deadline, token) => { await Task.Delay(200, token); return Required(SubmitSuccess.Completed.Create()); }, exception => throw exception);
        var receipt = Required(Receipt.Create(value: "limit:" + input.Limit.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        if (input.Input.Count == 2) return fx.Succeed(Required(SubmitSuccess.Queued.Create(receipt)));
        if (input.Input.Count == 3) return fx.Succeed(Required(SubmitSuccess.Completed.Create()));
        return fx.Succeed(Required(SubmitSuccess.Created.Create(receipt)));
    }

    /// <summary>Actual empty binary operation result</summary>
    /// <param name="input">Generated accepted empty input</param>
    /// <returns>Typed empty byte success</returns>
    public Effect<NoRequirements, DownloadRejection, DownloadSuccess> Download(DownloadInput input) =>
        new EffectContext<NoRequirements, DownloadRejection>().Succeed(Required(DownloadSuccess.Downloaded.Create(ImmutableArray<byte>.Empty)));

    /// <summary>Fixture setup invariant extraction without validation duplication</summary>
    /// <typeparam name="T">Generated representation</typeparam>
    /// <param name="result">Actual generated factory result</param>
    /// <returns>Completed fixture value</returns>
    /// <exception cref="InvalidOperationException">Invalid fixture setup</exception>
    private static T Required<T>(Result<Accepted<T>, ContractFailure> result) => result.IsFailed(out _, out var accepted)
        ? throw new InvalidOperationException("Invalid fixture setup") : accepted.Value;
}
