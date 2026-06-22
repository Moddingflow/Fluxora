namespace Fluxora.App.Services;

internal sealed class ProgressUpdateCoalescer<T> : IDisposable
    where T : class
{
    public static readonly TimeSpan DefaultMinimumInterval = TimeSpan.FromMilliseconds(33);

    private readonly object gate = new();
    private readonly Action<T> emit;
    private readonly Action<Action> dispatch;
    private readonly Func<T?, T, bool> shouldForceEmit;
    private readonly TimeSpan minimumInterval;
    private readonly Func<DateTimeOffset> getNow;
    private readonly Action<TimeSpan, Action> scheduleDelayed;

    private T? pendingUpdate;
    private T? lastObservedUpdate;
    private bool hasPendingUpdate;
    private bool delayedFlushScheduled;
    private bool disposed;
    private int scheduleVersion;
    private DateTimeOffset lastEmitAt = DateTimeOffset.MinValue;

    public ProgressUpdateCoalescer(
        Action<T> emit,
        Action<Action> dispatch,
        Func<T?, T, bool>? shouldForceEmit = null,
        TimeSpan? minimumInterval = null,
        Func<DateTimeOffset>? getNow = null,
        Action<TimeSpan, Action>? scheduleDelayed = null)
    {
        this.emit = emit ?? throw new ArgumentNullException(nameof(emit));
        this.dispatch = dispatch ?? throw new ArgumentNullException(nameof(dispatch));
        this.shouldForceEmit = shouldForceEmit ?? ((_, _) => false);
        this.minimumInterval = minimumInterval ?? DefaultMinimumInterval;
        this.getNow = getNow ?? (() => DateTimeOffset.UtcNow);
        this.scheduleDelayed = scheduleDelayed ?? ScheduleDelayedOnThreadPool;

        if (this.minimumInterval <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(minimumInterval), "Progress coalescing interval must be positive.");
        }
    }

    public void Report(T update)
    {
        if (update is null)
        {
            return;
        }

        Action? emitAction = null;
        TimeSpan delay = TimeSpan.Zero;
        int scheduledVersion = 0;
        bool shouldSchedule = false;

        lock (gate)
        {
            if (disposed)
            {
                return;
            }

            bool force = shouldForceEmit(lastObservedUpdate, update);
            lastObservedUpdate = update;
            pendingUpdate = update;
            hasPendingUpdate = true;

            DateTimeOffset now = getNow();
            TimeSpan elapsed = ElapsedSinceLastEmit(now);
            if (force || elapsed >= minimumInterval)
            {
                emitAction = TakePendingUpdateLocked(now);
            }
            else if (!delayedFlushScheduled)
            {
                delayedFlushScheduled = true;
                delay = minimumInterval - elapsed;
                scheduledVersion = scheduleVersion;
                shouldSchedule = true;
            }
        }

        if (emitAction is not null)
        {
            dispatch(emitAction);
        }

        if (shouldSchedule)
        {
            scheduleDelayed(delay, () => FlushScheduled(scheduledVersion));
        }
    }

    public void Flush()
    {
        Action? emitAction;
        lock (gate)
        {
            if (disposed)
            {
                return;
            }

            ++scheduleVersion;
            delayedFlushScheduled = false;
            emitAction = TakePendingUpdateLocked(getNow());
        }

        if (emitAction is not null)
        {
            dispatch(emitAction);
        }
    }

    public void Reset()
    {
        lock (gate)
        {
            ++scheduleVersion;
            pendingUpdate = null;
            lastObservedUpdate = null;
            hasPendingUpdate = false;
            delayedFlushScheduled = false;
            lastEmitAt = DateTimeOffset.MinValue;
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            disposed = true;
            ++scheduleVersion;
            pendingUpdate = null;
            lastObservedUpdate = null;
            hasPendingUpdate = false;
            delayedFlushScheduled = false;
        }
    }

    public static bool ShouldForcePhaseUpdate(string? previousPhase, string? currentPhase)
    {
        string normalizedCurrent = currentPhase?.Trim() ?? string.Empty;
        if (IsTerminalPhase(normalizedCurrent))
        {
            return true;
        }

        if (normalizedCurrent.Length == 0)
        {
            return false;
        }

        string normalizedPrevious = previousPhase?.Trim() ?? string.Empty;
        return !string.Equals(normalizedPrevious, normalizedCurrent, StringComparison.OrdinalIgnoreCase);
    }

    private void FlushScheduled(int scheduledVersion)
    {
        Action? emitAction = null;
        TimeSpan delay = TimeSpan.Zero;
        bool shouldSchedule = false;

        lock (gate)
        {
            if (disposed || scheduledVersion != scheduleVersion)
            {
                return;
            }

            delayedFlushScheduled = false;
            if (!hasPendingUpdate)
            {
                return;
            }

            DateTimeOffset now = getNow();
            TimeSpan elapsed = ElapsedSinceLastEmit(now);
            if (elapsed >= minimumInterval)
            {
                emitAction = TakePendingUpdateLocked(now);
            }
            else
            {
                delayedFlushScheduled = true;
                delay = minimumInterval - elapsed;
                shouldSchedule = true;
            }
        }

        if (emitAction is not null)
        {
            dispatch(emitAction);
        }

        if (shouldSchedule)
        {
            scheduleDelayed(delay, () => FlushScheduled(scheduledVersion));
        }
    }

    private Action? TakePendingUpdateLocked(DateTimeOffset now)
    {
        if (!hasPendingUpdate || pendingUpdate is null)
        {
            return null;
        }

        T update = pendingUpdate;
        pendingUpdate = null;
        hasPendingUpdate = false;
        delayedFlushScheduled = false;
        lastEmitAt = now;
        return () => emit(update);
    }

    private TimeSpan ElapsedSinceLastEmit(DateTimeOffset now)
    {
        if (lastEmitAt == DateTimeOffset.MinValue)
        {
            return TimeSpan.MaxValue;
        }

        TimeSpan elapsed = now - lastEmitAt;
        return elapsed < TimeSpan.Zero ? TimeSpan.Zero : elapsed;
    }

    private static bool IsTerminalPhase(string phase)
    {
        return phase.Equals("complete", StringComparison.OrdinalIgnoreCase) ||
            phase.Equals("completed", StringComparison.OrdinalIgnoreCase) ||
            phase.Equals("error", StringComparison.OrdinalIgnoreCase) ||
            phase.Equals("failed", StringComparison.OrdinalIgnoreCase) ||
            phase.Equals("failure", StringComparison.OrdinalIgnoreCase) ||
            phase.Equals("cancelled", StringComparison.OrdinalIgnoreCase) ||
            phase.Equals("canceled", StringComparison.OrdinalIgnoreCase);
    }

    private static void ScheduleDelayedOnThreadPool(TimeSpan delay, Action action)
    {
        _ = RunDelayedAsync(delay, action);
    }

    private static async Task RunDelayedAsync(TimeSpan delay, Action action)
    {
        try
        {
            await Task.Delay(delay).ConfigureAwait(false);
            action();
        }
        catch
        {
        }
    }
}
