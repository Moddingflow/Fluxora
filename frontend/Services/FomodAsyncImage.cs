using System.Threading;
using System.Windows;
using System.Windows.Media;
using WpfImage = System.Windows.Controls.Image;

namespace Fluxora.App.Services;

public static class FomodAsyncImage
{
    public static readonly DependencyProperty SourcePathProperty = DependencyProperty.RegisterAttached(
        "SourcePath",
        typeof(string),
        typeof(FomodAsyncImage),
        new PropertyMetadata(string.Empty, OnImageRequestChanged));

    public static readonly DependencyProperty DecodePixelWidthProperty = DependencyProperty.RegisterAttached(
        "DecodePixelWidth",
        typeof(int),
        typeof(FomodAsyncImage),
        new PropertyMetadata(900, OnImageRequestChanged));

    private static readonly DependencyProperty LoadVersionProperty = DependencyProperty.RegisterAttached(
        "LoadVersion",
        typeof(long),
        typeof(FomodAsyncImage),
        new PropertyMetadata(0L));

    private static long nextLoadVersion;

    public static void SetSourcePath(DependencyObject element, string value)
    {
        element.SetValue(SourcePathProperty, value);
    }

    public static string GetSourcePath(DependencyObject element)
    {
        return (string)element.GetValue(SourcePathProperty);
    }

    public static void SetDecodePixelWidth(DependencyObject element, int value)
    {
        element.SetValue(DecodePixelWidthProperty, value);
    }

    public static int GetDecodePixelWidth(DependencyObject element)
    {
        return (int)element.GetValue(DecodePixelWidthProperty);
    }

    private static void OnImageRequestChanged(DependencyObject dependencyObject, DependencyPropertyChangedEventArgs e)
    {
        if (dependencyObject is WpfImage image)
        {
            LoadAsync(image);
        }
    }

    private static async void LoadAsync(WpfImage image)
    {
        string path = GetSourcePath(image);
        int decodePixelWidth = Math.Max(1, GetDecodePixelWidth(image));
        long loadVersion = Interlocked.Increment(ref nextLoadVersion);
        image.SetValue(LoadVersionProperty, loadVersion);
        image.Source = null;

        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        ImageSource? source;
        try
        {
            source = await FomodImageSourceConverter.LoadImageAsync(path, decodePixelWidth);
        }
        catch (Exception)
        {
            return;
        }

        if ((long)image.GetValue(LoadVersionProperty) != loadVersion ||
            !string.Equals(GetSourcePath(image), path, StringComparison.OrdinalIgnoreCase) ||
            GetDecodePixelWidth(image) != decodePixelWidth)
        {
            return;
        }

        image.Source = source;
    }
}
