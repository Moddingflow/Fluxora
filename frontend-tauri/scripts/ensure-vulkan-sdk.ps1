$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sdkVersion = '1.4.341.1'
$sdkSha256 = 'bcf2d75aa9556889ab974858666e20b3655b6055a0db704ccb47279ff33b5bfe'
$sdkDownloadUrl = "https://sdk.lunarg.com/sdk/download/$sdkVersion/windows/vulkan_sdk.exe"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot '..')
$repoRoot = Resolve-Path -LiteralPath (Join-Path $projectRoot '..')
$toolCacheRoot = Join-Path $repoRoot 'build\tool-cache'
$sdkCacheRoot = Join-Path $toolCacheRoot 'vulkan-sdk'
$sdkRoot = Join-Path $sdkCacheRoot $sdkVersion
$downloadRoot = Join-Path $toolCacheRoot 'downloads'
$installerPath = Join-Path $downloadRoot "vulkansdk-windows-X64-$sdkVersion.exe"
$partialPath = "$installerPath.partial"

if (-not [string]::Equals($env:OS, 'Windows_NT', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The pinned LunarG Vulkan SDK bootstrap currently supports Windows only.'
}

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Test-VulkanSdkLayout {
    param([Parameter(Mandatory = $true)][string]$Root)
    return (
        (Test-Path -LiteralPath (Join-Path $Root 'Include\vulkan\vulkan.h') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $Root 'Lib\vulkan-1.lib') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $Root 'Bin\glslc.exe') -PathType Leaf)
    )
}

function Assert-ToolCacheChild {
    param([Parameter(Mandatory = $true)][string]$Path)
    $cacheFull = [System.IO.Path]::GetFullPath($toolCacheRoot).TrimEnd('\') + '\'
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    if (-not $pathFull.StartsWith($cacheFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify Vulkan SDK path outside the build tool cache: '$pathFull'."
    }
}

New-Item -ItemType Directory -Force -Path $downloadRoot,$sdkCacheRoot | Out-Null

if (-not (Test-VulkanSdkLayout -Root $sdkRoot)) {
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf) -or
        -not [string]::Equals((Get-Sha256Hex -Path $installerPath), $sdkSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
        if (-not (Get-Command 'curl.exe' -ErrorAction SilentlyContinue)) {
            throw 'curl.exe is required to download the pinned LunarG Vulkan SDK.'
        }
        Write-Host "Downloading pinned LunarG Vulkan SDK $sdkVersion..."
        & curl.exe --fail --location --retry 3 --retry-delay 2 --output $partialPath $sdkDownloadUrl
        if ($LASTEXITCODE -ne 0) {
            Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
            throw "LunarG Vulkan SDK download failed with exit code $LASTEXITCODE."
        }
        $actualHash = Get-Sha256Hex -Path $partialPath
        if (-not [string]::Equals($actualHash, $sdkSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
            throw "LunarG Vulkan SDK hash mismatch. Expected $sdkSha256, received $actualHash."
        }
        Move-Item -LiteralPath $partialPath -Destination $installerPath -Force
    }

    Assert-ToolCacheChild -Path $sdkRoot
    if (Test-Path -LiteralPath $sdkRoot) {
        Remove-Item -LiteralPath $sdkRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null
    $installerArguments = @(
        '--root', $sdkRoot,
        '--accept-licenses',
        '--default-answer',
        '--confirm-command',
        'install',
        'copy_only=1'
    )
    $installer = Start-Process -FilePath $installerPath -ArgumentList $installerArguments -WindowStyle Hidden -Wait -PassThru
    if ($installer.ExitCode -ne 0) {
        throw "LunarG Vulkan SDK copy-only bootstrap failed with exit code $($installer.ExitCode)."
    }
    if (-not (Test-VulkanSdkLayout -Root $sdkRoot)) {
        throw "LunarG Vulkan SDK $sdkVersion completed without the required headers, library, or glslc tool."
    }
}

$env:VULKAN_SDK = $sdkRoot
$env:VK_SDK_PATH = $sdkRoot
$sdkBin = Join-Path $sdkRoot 'Bin'
$pathEntries = $env:PATH -split ';'
if (-not ($pathEntries | Where-Object { [string]::Equals($_, $sdkBin, [System.StringComparison]::OrdinalIgnoreCase) })) {
    $env:PATH = "$sdkBin;$env:PATH"
}

Write-Host "Using pinned LunarG Vulkan SDK $sdkVersion from $sdkRoot"
