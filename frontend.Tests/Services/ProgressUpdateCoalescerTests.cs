using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class ProgressUpdateCoalescerTests
{
    [Fact]
    public void Report_CoalescesSyntheticBurstWithLastUpdateWins()
    {
        ManualScheduler scheduler = new();
        List<int> emitted = new();
        using ProgressUpdateCoalescer<ProgressSample> coalescer = CreateCoalescer(
            scheduler,
            progress => emitted.Add(progress.Value));

        for (int index = 0; index < 10_000; ++index)
        {
            coalescer.Report(new ProgressSample("copying", index));
        }

        Assert.Equal([0], emitted);
        Assert.Equal(1, scheduler.PendingCount);

        scheduler.Advance(ProgressUpdateCoalescer<ProgressSample>.DefaultMinimumInterval);

        Assert.Equal(2, emitted.Count);
        Assert.Equal(9_999, emitted[^1]);
        Assert.Equal(0, scheduler.PendingCount);
    }

    [Fact]
    public void Report_ForcesPhaseChangesAndTerminalUpdates()
    {
        ManualScheduler scheduler = new();
        List<string> emitted = new();
        using ProgressUpdateCoalescer<ProgressSample> coalescer = CreateCoalescer(
            scheduler,
            progress => emitted.Add($"{progress.Phase}:{progress.Value}"));

        coalescer.Report(new ProgressSample("preparing", 1));
        coalescer.Report(new ProgressSample("copying", 2));
        coalescer.Report(new ProgressSample("copying", 3));
        coalescer.Report(new ProgressSample("completed", 4));
        scheduler.Advance(ProgressUpdateCoalescer<ProgressSample>.DefaultMinimumInterval);

        Assert.Equal(
            ["preparing:1", "copying:2", "completed:4"],
            emitted);
    }

    [Fact]
    public void Flush_EmitsPendingUpdateAndCancelsDelayedFlush()
    {
        ManualScheduler scheduler = new();
        List<int> emitted = new();
        using ProgressUpdateCoalescer<ProgressSample> coalescer = CreateCoalescer(
            scheduler,
            progress => emitted.Add(progress.Value));

        coalescer.Report(new ProgressSample("copying", 1));
        coalescer.Report(new ProgressSample("copying", 2));

        coalescer.Flush();
        scheduler.Advance(ProgressUpdateCoalescer<ProgressSample>.DefaultMinimumInterval);

        Assert.Equal([1, 2], emitted);
    }

    [Fact]
    public void Report_SustainedUpdatesStayWithinThirtyFpsBudget()
    {
        ManualScheduler scheduler = new();
        List<int> emitted = new();
        using ProgressUpdateCoalescer<ProgressSample> coalescer = CreateCoalescer(
            scheduler,
            progress => emitted.Add(progress.Value));

        for (int index = 0; index < 10_000; ++index)
        {
            coalescer.Report(new ProgressSample("copying", index));
            scheduler.Advance(TimeSpan.FromMilliseconds(1));
        }

        coalescer.Flush();

        Assert.True(emitted.Count <= 305, $"Expected no more than 305 UI updates, got {emitted.Count}.");
        Assert.Equal(9_999, emitted[^1]);
    }

    [Fact]
    public void Report_CapturesEmitExceptionsWithoutEscaping()
    {
        ManualScheduler scheduler = new();
        List<Exception> captured = new();
        using ProgressUpdateCoalescer<ProgressSample> coalescer = new(
            _ => throw new InvalidOperationException("broken progress view"),
            action => action(),
            minimumInterval: ProgressUpdateCoalescer<ProgressSample>.DefaultMinimumInterval,
            getNow: () => scheduler.Now,
            scheduleDelayed: scheduler.Schedule,
            reportException: captured.Add);

        coalescer.Report(new ProgressSample("copying", 1));

        Exception exception = Assert.Single(captured);
        Assert.IsType<InvalidOperationException>(exception);
    }

    [Fact]
    public void Report_CapturesDispatchExceptionsWithoutEscaping()
    {
        ManualScheduler scheduler = new();
        List<Exception> captured = new();
        using ProgressUpdateCoalescer<ProgressSample> coalescer = new(
            _ => { },
            _ => throw new InvalidOperationException("dispatcher unavailable"),
            minimumInterval: ProgressUpdateCoalescer<ProgressSample>.DefaultMinimumInterval,
            getNow: () => scheduler.Now,
            scheduleDelayed: scheduler.Schedule,
            reportException: captured.Add);

        coalescer.Report(new ProgressSample("copying", 1));

        Exception exception = Assert.Single(captured);
        Assert.IsType<InvalidOperationException>(exception);
    }

    [Fact]
    public void Report_CapturesDelayedScheduleExceptionsWithoutEscaping()
    {
        ManualScheduler scheduler = new();
        List<Exception> captured = new();
        using ProgressUpdateCoalescer<ProgressSample> coalescer = new(
            _ => { },
            action => action(),
            minimumInterval: ProgressUpdateCoalescer<ProgressSample>.DefaultMinimumInterval,
            getNow: () => scheduler.Now,
            scheduleDelayed: (_, _) => throw new InvalidOperationException("timer unavailable"),
            reportException: captured.Add);

        coalescer.Report(new ProgressSample("copying", 1));
        coalescer.Report(new ProgressSample("copying", 2));

        Exception exception = Assert.Single(captured);
        Assert.IsType<InvalidOperationException>(exception);
    }

    private static ProgressUpdateCoalescer<ProgressSample> CreateCoalescer(
        ManualScheduler scheduler,
        Action<ProgressSample> emit)
    {
        return new ProgressUpdateCoalescer<ProgressSample>(
            emit,
            action => action(),
            (previous, current) => ProgressUpdateCoalescer<ProgressSample>.ShouldForcePhaseUpdate(
                previous?.Phase,
                current.Phase),
            ProgressUpdateCoalescer<ProgressSample>.DefaultMinimumInterval,
            () => scheduler.Now,
            scheduler.Schedule);
    }

    private sealed record ProgressSample(string Phase, int Value);

    private sealed class ManualScheduler
    {
        private readonly List<ScheduledAction> scheduled = new();

        public DateTimeOffset Now { get; private set; } = new(2026, 6, 22, 0, 0, 0, TimeSpan.Zero);

        public int PendingCount => scheduled.Count;

        public void Schedule(TimeSpan delay, Action action)
        {
            scheduled.Add(new ScheduledAction(Now + delay, action));
        }

        public void Advance(TimeSpan delay)
        {
            Now += delay;
            RunDueActions();
        }

        private void RunDueActions()
        {
            while (true)
            {
                ScheduledAction? due = scheduled
                    .Where(action => action.DueAt <= Now)
                    .OrderBy(action => action.DueAt)
                    .FirstOrDefault();
                if (due is null)
                {
                    return;
                }

                scheduled.Remove(due);
                due.Action();
            }
        }

        private sealed record ScheduledAction(DateTimeOffset DueAt, Action Action);
    }
}
