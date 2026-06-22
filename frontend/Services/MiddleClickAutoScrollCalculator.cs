namespace Fluxora.App.Services;

public static class MiddleClickAutoScrollCalculator
{
    public const double DeadZonePixels = 8;
    public const double RampPixels = 170;
    public const double MinimumVelocityPixelsPerSecond = 48;
    public const double MaximumVelocityPixelsPerSecond = 1500;
    public static readonly TimeSpan MaximumFrameTime = TimeSpan.FromMilliseconds(50);

    public static double CalculateVelocity(double pointerOffsetPixels)
    {
        double distance = Math.Abs(pointerOffsetPixels) - DeadZonePixels;
        if (distance <= 0)
        {
            return 0;
        }

        double progress = Math.Clamp(distance / RampPixels, 0, 1);
        double easedProgress = progress * progress;
        double velocity = MinimumVelocityPixelsPerSecond +
            ((MaximumVelocityPixelsPerSecond - MinimumVelocityPixelsPerSecond) * easedProgress);

        return Math.CopySign(velocity, pointerOffsetPixels);
    }

    public static double CalculateDelta(double pointerOffsetPixels, TimeSpan elapsed)
    {
        if (elapsed <= TimeSpan.Zero)
        {
            return 0;
        }

        TimeSpan clampedElapsed = elapsed > MaximumFrameTime ? MaximumFrameTime : elapsed;
        return CalculateVelocity(pointerOffsetPixels) * clampedElapsed.TotalSeconds;
    }
}
