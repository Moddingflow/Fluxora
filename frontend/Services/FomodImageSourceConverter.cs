using System.Globalization;
using System.IO;
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

    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        string imagePath = value as string ?? string.Empty;
        ImageSource? source = LoadImage(imagePath, DecodePixelWidth(parameter));
        return source ?? DependencyProperty.UnsetValue;
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

    private static ImageSource? LoadImage(string path, int decodePixelWidth)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        FileInfo fileInfo;
        try
        {
            fileInfo = new FileInfo(path);
            if (!fileInfo.Exists)
            {
                return null;
            }
        }
        catch (Exception exception) when (exception is ArgumentException or IOException or NotSupportedException or UnauthorizedAccessException)
        {
            return null;
        }

        string cacheKey = BuildCacheKey(fileInfo, decodePixelWidth);
        lock (CacheGate)
        {
            if (TryGetCached(cacheKey, out ImageSource? cached))
            {
                return cached;
            }
        }

        ImageSource? source = TryLoadImage(fileInfo.FullName, decodePixelWidth);
        if (source is null)
        {
            return null;
        }

        lock (CacheGate)
        {
            if (TryGetCached(cacheKey, out ImageSource? cached))
            {
                return cached;
            }

            AddCached(cacheKey, source);
            return source;
        }
    }

    private static string BuildCacheKey(FileInfo fileInfo, int decodePixelWidth)
    {
        return string.Join(
            '|',
            fileInfo.FullName,
            decodePixelWidth.ToString(CultureInfo.InvariantCulture),
            fileInfo.Length.ToString(CultureInfo.InvariantCulture),
            fileInfo.LastWriteTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture));
    }

    private static bool TryGetCached(string cacheKey, out ImageSource? source)
    {
        if (!Cache.TryGetValue(cacheKey, out LinkedListNode<CacheEntry>? node))
        {
            source = null;
            return false;
        }

        CacheOrder.Remove(node);
        CacheOrder.AddFirst(node);
        source = node.Value.Source;
        return true;
    }

    private static void AddCached(string cacheKey, ImageSource source)
    {
        LinkedListNode<CacheEntry> node = new(new CacheEntry(cacheKey, source));
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
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
        catch (NotSupportedException)
        {
            return null;
        }
        catch (UriFormatException)
        {
            return null;
        }
    }

    private sealed class CacheEntry
    {
        public CacheEntry(string key, ImageSource source)
        {
            Key = key;
            Source = source;
        }

        public string Key { get; }

        public ImageSource Source { get; }
    }
}
