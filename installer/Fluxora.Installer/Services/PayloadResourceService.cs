using System.IO;
using System.IO.Compression;
using System.Reflection;

namespace Fluxora.Installer.Services;

public sealed class PayloadResourceService
{
    private const string PayloadResourceSuffix = ".FluxoraPayload.flxpkg.gz";

    public Stream OpenPayloadPackageStream()
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        string? resourceName = assembly
            .GetManifestResourceNames()
            .FirstOrDefault(name => name.EndsWith(PayloadResourceSuffix, StringComparison.OrdinalIgnoreCase));

        if (resourceName is null)
        {
            throw new InvalidOperationException("Fluxora installer payload was not embedded. Run Build.ps1 to create output-installer.");
        }

        Stream? resource = assembly.GetManifestResourceStream(resourceName);
        if (resource is null)
        {
            throw new InvalidOperationException("Fluxora installer payload could not be opened.");
        }

        return new GZipStream(resource, CompressionMode.Decompress, leaveOpen: false);
    }
}
