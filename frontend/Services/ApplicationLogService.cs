using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace Fluxora.App.Services;

public enum ApplicationLogLevel
{
    Debug,
    Info,
    Warning,
    Error
}

public enum ApplicationLogChannel
{
    Ui,
    Bridge,
    Operations,
    Crash
}

public sealed class ApplicationLogService : IAppService, IDisposable
{
    private const int DefaultQueueCapacity = 4096;
    private const int DefaultFlushBatchSize = 128;
    private static readonly TimeSpan DefaultFlushInterval = TimeSpan.FromMilliseconds(100);

    private static readonly AsyncLocal<OperationContext?> CurrentOperation = new();
    private static readonly UTF8Encoding Utf8NoBom = new(false);

    private readonly object queueSyncRoot = new();
    private readonly object fileWriteSyncRoot = new();
    private readonly LinkedList<LogQueueItem> pendingLogItems = new();
    private readonly int queueCapacity;
    private readonly int flushBatchSize;
    private readonly TimeSpan flushInterval;

    private bool initialized;
    private bool acceptingLogItems;
    private int queuedLogWriteCount;
    private long droppedLowPriorityLineCount;
    private string logDirectory = string.Empty;
    private Task? logWorkerTask;

    public ApplicationLogService()
        : this(DefaultQueueCapacity, DefaultFlushBatchSize, DefaultFlushInterval)
    {
    }

    internal ApplicationLogService(
        int queueCapacity,
        int flushBatchSize,
        TimeSpan flushInterval)
    {
        this.queueCapacity = Math.Max(1, queueCapacity);
        this.flushBatchSize = Math.Max(1, flushBatchSize);
        this.flushInterval = flushInterval < TimeSpan.Zero ? TimeSpan.Zero : flushInterval;
    }

    public string LogPath => UiLogPath;
    public string UiLogPath { get; private set; } = string.Empty;
    public string BridgeLogPath { get; private set; } = string.Empty;
    public string OperationsLogPath { get; private set; } = string.Empty;
    public string CrashLogPath { get; private set; } = string.Empty;

    public static string CurrentOperationId => CurrentOperation.Value?.OperationId ?? string.Empty;

    internal long DroppedLowPriorityLineCount => Interlocked.Read(ref droppedLowPriorityLineCount);

    public Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (initialized)
        {
            return Task.CompletedTask;
        }

        logDirectory = ResolveLogDirectory();
        string stamp = DateTime.Now.ToString("yyyyMMdd");
        UiLogPath = Path.Combine(logDirectory, $"fluxora-ui-{stamp}.log");
        BridgeLogPath = Path.Combine(logDirectory, $"fluxora-bridge-{stamp}.log");
        OperationsLogPath = Path.Combine(logDirectory, $"fluxora-operations-{stamp}.log");
        CrashLogPath = Path.Combine(logDirectory, $"fluxora-crash-{stamp}.log");

        lock (queueSyncRoot)
        {
            pendingLogItems.Clear();
            queuedLogWriteCount = 0;
            acceptingLogItems = true;
        }

        logWorkerTask = Task.Run(ProcessLogQueue);
        initialized = true;
        Info("Logging", $"UI logger initialized. path=\"{UiLogPath}\", bridgePath=\"{BridgeLogPath}\", operationsPath=\"{OperationsLogPath}\", crashPath=\"{CrashLogPath}\"");
        return Task.CompletedTask;
    }

    public OperationLogScope BeginOperation(string name, string details = "")
    {
        string operationId = CreateOperationId();
        OperationContext? previous = CurrentOperation.Value;
        CurrentOperation.Value = new OperationContext(operationId, name, previous);

        string suffix = string.IsNullOrWhiteSpace(details) ? string.Empty : $" {details.Trim()}";
        Info("Operation", $"Operation started. name=\"{name}\"{suffix}");
        return new OperationLogScope(this, previous, operationId, name);
    }

    public void Debug(string category, string message)
    {
        if (IsDebugEnabled())
        {
            Write(ApplicationLogChannel.Ui, ApplicationLogLevel.Debug, category, message);
        }
    }

    public void Info(string category, string message)
    {
        Write(ApplicationLogChannel.Ui, ApplicationLogLevel.Info, category, message);
    }

    public void Warning(string category, string message, Exception? exception = null)
    {
        Write(ApplicationLogChannel.Ui, ApplicationLogLevel.Warning, category, message, exception);
    }

    public void Error(string category, string message, Exception? exception = null)
    {
        Write(ApplicationLogChannel.Ui, ApplicationLogLevel.Error, category, message, exception);
    }

    public void BridgeDebug(string category, string message)
    {
        if (IsDebugEnabled())
        {
            Write(ApplicationLogChannel.Bridge, ApplicationLogLevel.Debug, category, message);
        }
    }

    public void BridgeInfo(string category, string message)
    {
        Write(ApplicationLogChannel.Bridge, ApplicationLogLevel.Info, category, message);
    }

    public void BridgeWarning(string category, string message, Exception? exception = null)
    {
        Write(ApplicationLogChannel.Bridge, ApplicationLogLevel.Warning, category, message, exception);
    }

    public void BridgeError(string category, string message, Exception? exception = null)
    {
        Write(ApplicationLogChannel.Bridge, ApplicationLogLevel.Error, category, message, exception);
    }

    public void OperationInfo(string category, string message)
    {
        Write(ApplicationLogChannel.Operations, ApplicationLogLevel.Info, category, message);
    }

    public void OperationWarning(string category, string message, Exception? exception = null)
    {
        Write(ApplicationLogChannel.Operations, ApplicationLogLevel.Warning, category, message, exception);
    }

    public void OperationError(string category, string message, Exception? exception = null)
    {
        Write(ApplicationLogChannel.Operations, ApplicationLogLevel.Error, category, message, exception);
    }

    public void CrashError(string category, string message, Exception? exception = null)
    {
        Write(ApplicationLogChannel.Crash, ApplicationLogLevel.Error, category, message, exception);
    }

    public void Dispose()
    {
        if (!initialized)
        {
            return;
        }

        Info("Logging", "UI logger shut down.");
        initialized = false;
        StopLogWorker();
    }

    internal Task FlushAsync(CancellationToken cancellationToken = default)
    {
        if (!initialized)
        {
            return Task.CompletedTask;
        }

        TaskCompletionSource<bool> completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!EnqueueFlushMarker(completion))
        {
            return Task.CompletedTask;
        }

        return completion.Task.WaitAsync(cancellationToken);
    }

    private void Write(
        ApplicationLogChannel channel,
        ApplicationLogLevel level,
        string category,
        string message,
        Exception? exception = null)
    {
        if (!initialized)
        {
            return;
        }

        string safeCategory = string.IsNullOrWhiteSpace(category) ? "App" : category.Trim();
        string operationId = CurrentOperationId;
        string line = $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz} [{FormatLevel(level)}] [{FormatChannel(channel)}] [{safeCategory}] [tid={Environment.CurrentManagedThreadId}]";
        if (!string.IsNullOrWhiteSpace(operationId))
        {
            line += $" [op={operationId}]";
        }

        line += $" {message}";
        if (exception is not null)
        {
            line += Environment.NewLine + exception;
        }

        string path = PathForChannel(channel);
        if (RequiresImmediateWriteThrough(channel))
        {
            AppendLines(path, new[] { line }, writeThrough: true);
        }
        else
        {
            EnqueueLogWrite(new LogQueueItem(path, line, channel, level));
        }

        if (channel != ApplicationLogChannel.Operations && !string.IsNullOrWhiteSpace(operationId))
        {
            EnqueueLogWrite(new LogQueueItem(OperationsLogPath, line, ApplicationLogChannel.Operations, level));
        }

        Trace.WriteLine(line);
    }

    private void EnqueueLogWrite(LogQueueItem item)
    {
        bool writeSynchronously = false;

        lock (queueSyncRoot)
        {
            if (!acceptingLogItems)
            {
                return;
            }

            if (queuedLogWriteCount >= queueCapacity)
            {
                if (IsLowPriority(item))
                {
                    Interlocked.Increment(ref droppedLowPriorityLineCount);
                    return;
                }

                if (TryRemoveOldestLowPriorityLocked())
                {
                    Interlocked.Increment(ref droppedLowPriorityLineCount);
                }
                else
                {
                    writeSynchronously = true;
                }
            }

            if (!writeSynchronously)
            {
                pendingLogItems.AddLast(item);
                queuedLogWriteCount++;
                Monitor.Pulse(queueSyncRoot);
                return;
            }
        }

        AppendLines(item.Path, new[] { item.Line }, writeThrough: false);
    }

    private bool EnqueueFlushMarker(TaskCompletionSource<bool> completion)
    {
        lock (queueSyncRoot)
        {
            if (!acceptingLogItems)
            {
                return false;
            }

            pendingLogItems.AddLast(new LogQueueItem(completion));
            Monitor.Pulse(queueSyncRoot);
            return true;
        }
    }

    private void StopLogWorker()
    {
        Task? worker;
        lock (queueSyncRoot)
        {
            acceptingLogItems = false;
            Monitor.PulseAll(queueSyncRoot);
            worker = logWorkerTask;
        }

        try
        {
            worker?.GetAwaiter().GetResult();
        }
        catch
        {
        }
    }

    private void ProcessLogQueue()
    {
        List<LogQueueItem> batch = new(flushBatchSize);

        while (true)
        {
            batch.Clear();

            lock (queueSyncRoot)
            {
                while (pendingLogItems.Count == 0 && acceptingLogItems)
                {
                    Monitor.Wait(queueSyncRoot);
                }

                if (pendingLogItems.Count == 0 && !acceptingLogItems)
                {
                    return;
                }

                WaitForBatchReadyLocked();

                DrainBatchLocked(batch);
            }

            FlushBatch(batch);
        }
    }

    private void WaitForBatchReadyLocked()
    {
        if (!acceptingLogItems ||
            queuedLogWriteCount == 0 ||
            queuedLogWriteCount >= flushBatchSize ||
            flushInterval <= TimeSpan.Zero ||
            ContainsFlushMarkerLocked())
        {
            return;
        }

        DateTime deadline = DateTime.UtcNow + flushInterval;
        while (acceptingLogItems &&
            queuedLogWriteCount > 0 &&
            queuedLogWriteCount < flushBatchSize &&
            !ContainsFlushMarkerLocked())
        {
            TimeSpan remaining = deadline - DateTime.UtcNow;
            if (remaining <= TimeSpan.Zero)
            {
                return;
            }

            Monitor.Wait(queueSyncRoot, remaining);
        }
    }

    private void DrainBatchLocked(List<LogQueueItem> batch)
    {
        int drainedLogWrites = 0;
        while (pendingLogItems.First is not null && drainedLogWrites < flushBatchSize)
        {
            LogQueueItem item = pendingLogItems.First.Value;
            pendingLogItems.RemoveFirst();
            batch.Add(item);

            if (!item.IsFlushMarker)
            {
                queuedLogWriteCount--;
                drainedLogWrites++;
            }
        }

        while (pendingLogItems.First?.Value.IsFlushMarker == true)
        {
            batch.Add(pendingLogItems.First.Value);
            pendingLogItems.RemoveFirst();
        }
    }

    private void FlushBatch(List<LogQueueItem> batch)
    {
        Dictionary<string, List<string>> pendingWrites = new(StringComparer.OrdinalIgnoreCase);

        foreach (LogQueueItem item in batch)
        {
            if (item.FlushCompletion is not null)
            {
                FlushPendingWrites(pendingWrites);
                item.FlushCompletion.TrySetResult(true);
                continue;
            }

            if (!pendingWrites.TryGetValue(item.Path, out List<string>? lines))
            {
                lines = new List<string>();
                pendingWrites[item.Path] = lines;
            }

            lines.Add(item.Line);
        }

        FlushPendingWrites(pendingWrites);
    }

    private void FlushPendingWrites(Dictionary<string, List<string>> pendingWrites)
    {
        if (pendingWrites.Count == 0)
        {
            return;
        }

        lock (fileWriteSyncRoot)
        {
            foreach (KeyValuePair<string, List<string>> pendingWrite in pendingWrites)
            {
                AppendLinesCore(pendingWrite.Key, pendingWrite.Value, writeThrough: false);
            }
        }

        pendingWrites.Clear();
    }

    private void AppendLines(string path, IReadOnlyCollection<string> lines, bool writeThrough)
    {
        lock (fileWriteSyncRoot)
        {
            AppendLinesCore(path, lines, writeThrough);
        }
    }

    private static void AppendLinesCore(string path, IReadOnlyCollection<string> lines, bool writeThrough)
    {
        if (lines.Count == 0 || string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        try
        {
            string? directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            FileOptions options = writeThrough ? FileOptions.WriteThrough : FileOptions.None;
            using FileStream stream = new(
                path,
                FileMode.Append,
                FileAccess.Write,
                FileShare.ReadWrite,
                4096,
                options);
            using StreamWriter writer = new(stream, Utf8NoBom);
            foreach (string line in lines)
            {
                writer.WriteLine(line);
            }

            writer.Flush();
            if (writeThrough)
            {
                stream.Flush(flushToDisk: true);
            }
        }
        catch
        {
        }
    }

    private bool ContainsFlushMarkerLocked()
    {
        LinkedListNode<LogQueueItem>? node = pendingLogItems.First;
        while (node is not null)
        {
            if (node.Value.IsFlushMarker)
            {
                return true;
            }

            node = node.Next;
        }

        return false;
    }

    private bool TryRemoveOldestLowPriorityLocked()
    {
        LinkedListNode<LogQueueItem>? node = pendingLogItems.First;
        while (node is not null)
        {
            LinkedListNode<LogQueueItem>? next = node.Next;
            if (IsLowPriority(node.Value))
            {
                pendingLogItems.Remove(node);
                queuedLogWriteCount--;
                return true;
            }

            node = next;
        }

        return false;
    }

    private static bool IsLowPriority(LogQueueItem item)
    {
        return !item.IsFlushMarker &&
            (item.Level == ApplicationLogLevel.Debug ||
                (item.Level == ApplicationLogLevel.Info &&
                    item.Channel is ApplicationLogChannel.Ui or ApplicationLogChannel.Bridge));
    }

    private static bool RequiresImmediateWriteThrough(ApplicationLogChannel channel)
    {
        return channel == ApplicationLogChannel.Crash;
    }

    private string PathForChannel(ApplicationLogChannel channel)
    {
        return channel switch
        {
            ApplicationLogChannel.Bridge => BridgeLogPath,
            ApplicationLogChannel.Operations => OperationsLogPath,
            ApplicationLogChannel.Crash => CrashLogPath,
            _ => UiLogPath
        };
    }

    private static string FormatLevel(ApplicationLogLevel level)
    {
        return level switch
        {
            ApplicationLogLevel.Debug => "DEBUG",
            ApplicationLogLevel.Info => "INFO",
            ApplicationLogLevel.Warning => "WARNING",
            ApplicationLogLevel.Error => "ERROR",
            _ => "UNKNOWN"
        };
    }

    private static string FormatChannel(ApplicationLogChannel channel)
    {
        return channel switch
        {
            ApplicationLogChannel.Ui => "UI",
            ApplicationLogChannel.Bridge => "Bridge",
            ApplicationLogChannel.Operations => "Operations",
            ApplicationLogChannel.Crash => "Crash",
            _ => "UI"
        };
    }

    private static bool IsDebugEnabled()
    {
        string? value = Environment.GetEnvironmentVariable("FLUXORA_DEBUG_LOGS");
        return string.Equals(value, "1", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(value, "true", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(value, "yes", StringComparison.OrdinalIgnoreCase);
    }

    private static string ResolveLogDirectory()
    {
        foreach (string directory in EnumerateLogDirectories())
        {
            try
            {
                Directory.CreateDirectory(directory);
                string probe = Path.Combine(directory, ".fluxora-log-probe");
                using (FileStream stream = new(probe, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
                {
                }

                File.Delete(probe);
                return directory;
            }
            catch
            {
            }
        }

        string fallback = Path.Combine(Path.GetTempPath(), "Fluxora", "logs");
        Directory.CreateDirectory(fallback);
        return fallback;
    }

    private static IEnumerable<string> EnumerateLogDirectories()
    {
        yield return Path.Combine(AppContext.BaseDirectory, "logs");

        string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (!string.IsNullOrWhiteSpace(appData))
        {
            yield return Path.Combine(appData, "Fluxora", "logs");
        }
    }

    private static string CreateOperationId()
    {
        return Guid.NewGuid().ToString("N");
    }

    internal sealed record OperationContext(
        string OperationId,
        string Name,
        OperationContext? Parent);

    private sealed class LogQueueItem
    {
        public LogQueueItem(
            string path,
            string line,
            ApplicationLogChannel channel,
            ApplicationLogLevel level)
        {
            Path = path;
            Line = line;
            Channel = channel;
            Level = level;
        }

        public LogQueueItem(TaskCompletionSource<bool> flushCompletion)
        {
            FlushCompletion = flushCompletion;
            Path = string.Empty;
            Line = string.Empty;
        }

        public string Path { get; }
        public string Line { get; }
        public ApplicationLogChannel Channel { get; }
        public ApplicationLogLevel Level { get; }
        public TaskCompletionSource<bool>? FlushCompletion { get; }
        public bool IsFlushMarker => FlushCompletion is not null;
    }

    public sealed class OperationLogScope : IDisposable
    {
        private readonly ApplicationLogService owner;
        private readonly OperationContext? previous;
        private readonly string name;
        private readonly Stopwatch stopwatch = Stopwatch.StartNew();
        private bool finished;

        internal OperationLogScope(
            ApplicationLogService owner,
            OperationContext? previous,
            string operationId,
            string name)
        {
            this.owner = owner;
            this.previous = previous;
            OperationId = operationId;
            this.name = name;
        }

        public string OperationId { get; }

        public void Complete(string message = "")
        {
            if (finished)
            {
                return;
            }

            finished = true;
            string suffix = string.IsNullOrWhiteSpace(message) ? string.Empty : $" {message.Trim()}";
            owner.OperationInfo("Operation", $"Operation completed. name=\"{name}\", elapsedMs={stopwatch.ElapsedMilliseconds}{suffix}");
        }

        public void Fail(Exception exception, string message = "")
        {
            if (finished)
            {
                return;
            }

            finished = true;
            string suffix = string.IsNullOrWhiteSpace(message) ? string.Empty : $" {message.Trim()}";
            owner.OperationError("Operation", $"Operation failed. name=\"{name}\", elapsedMs={stopwatch.ElapsedMilliseconds}{suffix}", exception);
        }

        public void Dispose()
        {
            if (!finished)
            {
                owner.BridgeDebug("Operation", $"Operation scope disposed without terminal status. name=\"{name}\", elapsedMs={stopwatch.ElapsedMilliseconds}");
            }

            CurrentOperation.Value = previous;
        }
    }
}
