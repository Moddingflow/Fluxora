using System.IO;
using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class ApplicationLogServiceTests
{
    [Fact]
    public async Task BeginOperationAddsOperationIdToUiAndOperationsLogs()
    {
        using ApplicationLogService logger = new();
        await logger.InitializeAsync(TestContext.Current.CancellationToken);
        string marker = $"operation-log-test-{Guid.NewGuid():N}";

        string operationId;
        using (ApplicationLogService.OperationLogScope operation =
            logger.BeginOperation("TestOperation", $"marker={marker}"))
        {
            operationId = operation.OperationId;
            Assert.False(string.IsNullOrWhiteSpace(operationId));
            Assert.Equal(operationId, ApplicationLogService.CurrentOperationId);

            logger.BridgeInfo("TestBridge", $"bridge-marker={marker}");
            operation.Complete($"complete-marker={marker}");
        }

        Assert.Equal(string.Empty, ApplicationLogService.CurrentOperationId);

        await logger.FlushAsync(TestContext.Current.CancellationToken);

        string uiLog = await File.ReadAllTextAsync(logger.UiLogPath, TestContext.Current.CancellationToken);
        string operationsLog = await File.ReadAllTextAsync(logger.OperationsLogPath, TestContext.Current.CancellationToken);

        Assert.Contains(marker, uiLog);
        Assert.Contains($"op={operationId}", uiLog);
        Assert.Contains(marker, operationsLog);
        Assert.Contains($"op={operationId}", operationsLog);
        Assert.Contains("TestBridge", operationsLog);
    }

    [Fact]
    public async Task CrashErrorWritesCrashLogImmediately()
    {
        using ApplicationLogService logger = new(
            queueCapacity: 4,
            flushBatchSize: 128,
            flushInterval: TimeSpan.FromSeconds(30));
        await logger.InitializeAsync(TestContext.Current.CancellationToken);
        string marker = $"crash-log-test-{Guid.NewGuid():N}";

        logger.CrashError("TestCrash", marker);

        string crashLog = await File.ReadAllTextAsync(logger.CrashLogPath, TestContext.Current.CancellationToken);
        Assert.Contains(marker, crashLog);
    }

    [Fact]
    public async Task LowPriorityLogsAreDroppedWhenBackgroundQueueIsFull()
    {
        using ApplicationLogService logger = new(
            queueCapacity: 4,
            flushBatchSize: 128,
            flushInterval: TimeSpan.FromSeconds(30));
        await logger.InitializeAsync(TestContext.Current.CancellationToken);
        string marker = $"queue-pressure-test-{Guid.NewGuid():N}";

        for (int index = 0; index < 32; index++)
        {
            logger.BridgeInfo("Noisy", $"{marker}-bridge-info-{index}");
        }

        logger.Warning("Important", $"{marker}-warning");
        await logger.FlushAsync(TestContext.Current.CancellationToken);

        string uiLog = await File.ReadAllTextAsync(logger.UiLogPath, TestContext.Current.CancellationToken);
        Assert.True(logger.DroppedLowPriorityLineCount > 0);
        Assert.Contains($"{marker}-warning", uiLog);
    }
}
