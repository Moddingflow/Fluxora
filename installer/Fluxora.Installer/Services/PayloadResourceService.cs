using System.IO;
using System.Reflection;

namespace Fluxora.Installer.Services;

public sealed class PayloadResourceService
{
    private const string PayloadResourceSuffix = ".FluxoraPayload.flxpkg";
    private const int CopyBufferSize = 1024 * 1024;

    public async Task<string> ExtractPayloadToTempAsync(CancellationToken cancellationToken = default)
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        string? resourceName = assembly
            .GetManifestResourceNames()
            .FirstOrDefault(name => name.EndsWith(PayloadResourceSuffix, StringComparison.OrdinalIgnoreCase));

        if (resourceName is null)
        {
            throw new InvalidOperationException("Fluxora installer payload was not embedded. Run Build.ps1 to create output-installer.");
        }

        string directory = Path.Combine(Path.GetTempPath(), "Fluxora", "installer", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        string packagePath = Path.Combine(directory, "FluxoraPayload.flxpkg");

        try
        {
            using Stream? resource = assembly.GetManifestResourceStream(resourceName);
            if (resource is null)
            {
                throw new InvalidOperationException("Fluxora installer payload could not be opened.");
            }

            await using FileStream output = new(
                packagePath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.Read,
                CopyBufferSize,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            await resource.CopyToAsync(output, CopyBufferSize, cancellationToken);
            return packagePath;
        }
        catch
        {
            TryDeletePayload(packagePath);
            throw;
        }
    }

    public void TryDeletePayload(string packagePath)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(packagePath))
            {
                return;
            }

            string? directory = Path.GetDirectoryName(packagePath);
            if (File.Exists(packagePath))
            {
                File.Delete(packagePath);
            }

            if (!string.IsNullOrWhiteSpace(directory) && Directory.Exists(directory))
            {
                Directory.Delete(directory, recursive: true);
            }
        }
        catch
        {
        }
    }
}
