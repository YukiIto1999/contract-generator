using EffectSystem.Domain;

namespace Consumer.Infrastructure;

/// <summary>Consumer timeout competing with the runtime deadline owner</summary>
public static class CompetingDeadlineTimer
{
    /// <summary>Invalid second cancellation source derived from an incoming deadline</summary>
    /// <param name="deadline">Absolute deadline owned by the caller</param>
    /// <param name="clock">Clock for measuring the remaining duration</param>
    public static void Schedule(Deadline deadline, TimeProvider clock)
    {
        using var source = new CancellationTokenSource(deadline.Remaining(clock));
    }
}
