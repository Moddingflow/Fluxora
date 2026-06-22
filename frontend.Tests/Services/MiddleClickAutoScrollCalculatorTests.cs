using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class MiddleClickAutoScrollCalculatorTests
{
    [Fact]
    public void CalculateVelocity_ReturnsZeroInsideDeadZone()
    {
        Assert.Equal(0, MiddleClickAutoScrollCalculator.CalculateVelocity(0));
        Assert.Equal(0, MiddleClickAutoScrollCalculator.CalculateVelocity(
            MiddleClickAutoScrollCalculator.DeadZonePixels));
        Assert.Equal(0, MiddleClickAutoScrollCalculator.CalculateVelocity(
            -MiddleClickAutoScrollCalculator.DeadZonePixels));
    }

    [Fact]
    public void CalculateVelocity_PreservesDirection()
    {
        double down = MiddleClickAutoScrollCalculator.CalculateVelocity(48);
        double up = MiddleClickAutoScrollCalculator.CalculateVelocity(-48);

        Assert.True(down > 0);
        Assert.True(up < 0);
        Assert.Equal(Math.Abs(down), Math.Abs(up), 6);
    }

    [Fact]
    public void CalculateVelocity_CapsAtMaximum()
    {
        double velocity = MiddleClickAutoScrollCalculator.CalculateVelocity(10_000);

        Assert.Equal(MiddleClickAutoScrollCalculator.MaximumVelocityPixelsPerSecond, velocity);
    }

    [Fact]
    public void CalculateDelta_ClampsLongFrames()
    {
        double longFrameDelta = MiddleClickAutoScrollCalculator.CalculateDelta(
            10_000,
            TimeSpan.FromSeconds(1));
        double clampedFrameDelta = MiddleClickAutoScrollCalculator.CalculateDelta(
            10_000,
            MiddleClickAutoScrollCalculator.MaximumFrameTime);

        Assert.Equal(clampedFrameDelta, longFrameDelta);
    }

    [Fact]
    public void CalculateDelta_IncreasesWithPointerDistance()
    {
        TimeSpan elapsed = TimeSpan.FromMilliseconds(16);

        double nearDelta = MiddleClickAutoScrollCalculator.CalculateDelta(20, elapsed);
        double farDelta = MiddleClickAutoScrollCalculator.CalculateDelta(140, elapsed);

        Assert.True(farDelta > nearDelta);
    }
}
