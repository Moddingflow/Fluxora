using System.IO;
using System.Windows.Media;
using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class FomodImageSourceConverterTests
{
    [Fact]
    public async Task LoadImageSource_ReturnsNullUntilBackgroundCacheIsWarm()
    {
        string path = Path.Combine(Path.GetTempPath(), $"fluxora-fomod-preview-{Guid.NewGuid():N}.bmp");
        File.WriteAllBytes(path, CreateTinyBmp());

        try
        {
            Assert.Null(FomodImageSourceConverter.LoadImageSource(path, 64));

            ImageSource? loaded = await FomodImageSourceConverter.LoadImageAsync(path, 64);

            Assert.NotNull(loaded);
            Assert.True(loaded.IsFrozen);
            Assert.Same(loaded, FomodImageSourceConverter.LoadImageSource(path, 64));
        }
        finally
        {
            File.Delete(path);
        }
    }

    private static byte[] CreateTinyBmp()
    {
        return
        [
            0x42, 0x4D,
            0x3A, 0x00, 0x00, 0x00,
            0x00, 0x00,
            0x00, 0x00,
            0x36, 0x00, 0x00, 0x00,
            0x28, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x00, 0x00,
            0x01, 0x00,
            0x18, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x04, 0x00, 0x00, 0x00,
            0x13, 0x0B, 0x00, 0x00,
            0x13, 0x0B, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0xFF, 0x00
        ];
    }
}
