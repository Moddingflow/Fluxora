using System.Globalization;
using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Fluxora.App.Services;

public sealed class FomodImageSourceConverter : IValueConverter
{
    private const int MaxCachedImages = 48;

    private static readonly object CacheGate = new();
    private static readonly Dictionary<string, LinkedListNode<CacheEntry>> Cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly LinkedList<CacheEntry> CacheOrder = new();
    private static readonly Dictionary<string, Task<ImageSource?>> PendingLoads = new(StringComparer.OrdinalIgnoreCase);

    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        string imagePath = value as string ?? string.Empty;
        int decodePixelWidth = DecodePixelWidth(parameter);
        if (TryGetCachedImageSource(imagePath, decodePixelWidth, out ImageSource? source))
        {
            return source;
        }

        _ = PrewarmImageAsync(imagePath, decodePixelWidth);
        return DependencyProperty.UnsetValue;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
    {
        throw new NotSupportedException();
    }

    private static int DecodePixelWidth(object parameter)
    {
        if (parameter is string text &&
            int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed) &&
            parsed > 0)
        {
            return parsed;
        }

        return 900;
    }

    internal static ImageSource? LoadImageSource(string path, int decodePixelWidth)
    {
        return TryGetCachedImageSource(path, decodePixelWidth, out ImageSource? source)
            ? source
            : null;
    }

    internal static Task<ImageSource?> LoadImageAsync(string path, int decodePixelWidth)
    {
        return QueueImageLoad(path, NormalizeDecodePixelWidth(decodePixelWidth));
    }

    internal static Task<ImageSource?> PrewarmImageAsync(string path, int decodePixelWidth)
    {
        return QueueImageLoad(path, NormalizeDecodePixelWidth(decodePixelWidth));
    }

    internal static bool TryGetCachedImageSource(
        string path,
        int decodePixelWidth,
        [NotNullWhen(true)] out ImageSource? source)
    {
        string? cacheKey = TryBuildCacheKey(path, NormalizeDecodePixelWidth(decodePixelWidth));
        if (cacheKey is null)
        {
            source = null;
            return false;
        }

        lock (CacheGate)
        {
            return TryGetCached(cacheKey, out source);
        }
    }

    private static Task<ImageSource?> QueueImageLoad(string path, int decodePixelWidth)
    {
        string? cacheKey = TryBuildCacheKey(path, decodePixelWidth);
        if (cacheKey is null)
        {
            return Task.FromResult<ImageSource?>(null);
        }

        lock (CacheGate)
        {
            if (TryGetCached(cacheKey, out ImageSource? cached))
            {
                return Task.FromResult<ImageSource?>(cached);
            }

            if (PendingLoads.TryGetValue(cacheKey, out Task<ImageSource?>? pending))
            {
                return pending;
            }

            Task<ImageSource?> load = Task.Run(() => LoadImage(cacheKey, path, decodePixelWidth));
            PendingLoads[cacheKey] = load;
            _ = load.ContinueWith(
                _ =>
                {
                    lock (CacheGate)
                    {
                        PendingLoads.Remove(cacheKey);
                    }
                },
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
            return load;
        }
    }

    private static ImageSource? LoadImage(string cacheKey, string path, int decodePixelWidth)
    {
        if (!TryGetFileInfo(path, out FileInfo fileInfo))
        {
            return null;
        }

        lock (CacheGate)
        {
            if (TryGetCached(cacheKey, out CacheEntry? cachedEntry))
            {
                if (cachedEntry.Matches(fileInfo))
                {
                    return cachedEntry.Source;
                }

                RemoveCached(cacheKey);
            }
        }

        ImageSource? source = TryLoadImage(fileInfo.FullName, decodePixelWidth);
        if (source is null)
        {
            return null;
        }

        lock (CacheGate)
        {
            if (TryGetCached(cacheKey, out CacheEntry? cachedEntry) &&
                cachedEntry.Matches(fileInfo))
            {
                return cachedEntry.Source;
            }

            AddCached(cacheKey, source, fileInfo);
            return source;
        }
    }

    private static bool TryGetFileInfo(string path, out FileInfo fileInfo)
    {
        try
        {
            fileInfo = new FileInfo(path);
            return fileInfo.Exists;
        }
        catch (Exception exception) when (IsRecoverableFileException(exception))
        {
            fileInfo = null!;
            return false;
        }
    }

    private static string? TryBuildCacheKey(string path, int decodePixelWidth)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        string trimmedPath = path.Trim();
        string normalizedPath;
        try
        {
            normalizedPath = Path.GetFullPath(trimmedPath);
        }
        catch (Exception exception) when (IsRecoverableFileException(exception))
        {
            normalizedPath = trimmedPath;
        }

        return string.Join(
            '|',
            normalizedPath,
            decodePixelWidth.ToString(CultureInfo.InvariantCulture));
    }

    private static int NormalizeDecodePixelWidth(int decodePixelWidth)
    {
        return Math.Max(1, decodePixelWidth);
    }

    private static bool IsRecoverableFileException(Exception exception)
    {
        return exception is ArgumentException or IOException or NotSupportedException or UnauthorizedAccessException;
    }

    private static bool IsRecoverableImageException(Exception exception)
    {
        return exception is ArgumentException or IOException or InvalidOperationException or NotSupportedException or UnauthorizedAccessException or UriFormatException;
    }

    private static bool TryGetCached(string cacheKey, [NotNullWhen(true)] out ImageSource? source)
    {
        if (!TryGetCached(cacheKey, out CacheEntry? entry))
        {
            source = null;
            return false;
        }

        source = entry.Source;
        return true;
    }

    private static bool TryGetCached(string cacheKey, [NotNullWhen(true)] out CacheEntry? entry)
    {
        if (!Cache.TryGetValue(cacheKey, out LinkedListNode<CacheEntry>? node))
        {
            entry = null;
            return false;
        }

        CacheOrder.Remove(node);
        CacheOrder.AddFirst(node);
        entry = node.Value;
        return true;
    }

    private static void RemoveCached(string cacheKey)
    {
        if (!Cache.TryGetValue(cacheKey, out LinkedListNode<CacheEntry>? node))
        {
            return;
        }

        CacheOrder.Remove(node);
        Cache.Remove(cacheKey);
    }

    private static void AddCached(string cacheKey, ImageSource source, FileInfo fileInfo)
    {
        RemoveCached(cacheKey);

        LinkedListNode<CacheEntry> node = new(new CacheEntry(
            cacheKey,
            source,
            fileInfo.Length,
            fileInfo.LastWriteTimeUtc.Ticks));
        CacheOrder.AddFirst(node);
        Cache[cacheKey] = node;

        while (Cache.Count > MaxCachedImages && CacheOrder.Last is not null)
        {
            LinkedListNode<CacheEntry> last = CacheOrder.Last;
            CacheOrder.RemoveLast();
            Cache.Remove(last.Value.Key);
        }
    }

    private static ImageSource? TryLoadImage(string path, int decodePixelWidth)
    {
        try
        {
            BitmapImage image = new();
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
            image.DecodePixelWidth = decodePixelWidth;
            image.UriSource = new Uri(path, UriKind.Absolute);
            image.EndInit();
            image.Freeze();
            return image;
        }
        catch (Exception exception) when (IsRecoverableImageException(exception))
        {
            return null;
        }
    }

    private sealed class CacheEntry
    {
        public CacheEntry(string key, ImageSource source, long length, long lastWriteTimeUtcTicks)
        {
            Key = key;
            Source = source;
            Length = length;
            LastWriteTimeUtcTicks = lastWriteTimeUtcTicks;
        }

        public string Key { get; }

        public ImageSource Source { get; }

        private long Length { get; }

        private long LastWriteTimeUtcTicks { get; }

        public bool Matches(FileInfo fileInfo)
        {
            try
            {
                return Length == fileInfo.Length &&
                    LastWriteTimeUtcTicks == fileInfo.LastWriteTimeUtc.Ticks;
            }
            catch (Exception exception) when (IsRecoverableFileException(exception))
            {
                return false;
            }
        }
    }
}
