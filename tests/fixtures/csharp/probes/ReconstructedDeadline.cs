using EffectSystem.Domain;

namespace Consumer.Infrastructure;

/// <summary>Consumer forwarding a reconstructed deadline instead of its incoming value</summary>
public static class ReconstructedDeadline
{
    /// <summary>Invalid reconstruction at a downstream operation boundary</summary>
    /// <param name="deadline">Absolute deadline to preserve</param>
    /// <param name="token">Caller cancellation forwarded unchanged</param>
    /// <returns>Downstream operation completion</returns>
    public static Task Forward(Deadline deadline, CancellationToken token) =>
        Receive(new Deadline(deadline.At), token);

    /// <summary>Downstream boundary for the forwarded deadline</summary>
    /// <param name="deadline">Absolute deadline received from the caller</param>
    /// <param name="token">Caller cancellation</param>
    /// <returns>Completed downstream operation</returns>
    private static Task Receive(Deadline deadline, CancellationToken token) => Task.CompletedTask;
}
