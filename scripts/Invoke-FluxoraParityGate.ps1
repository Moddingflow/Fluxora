param(
    [switch]$SkipE2E,
    [switch]$SkipBackend,
    [switch]$ReleaseSmoke
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ElectronRoot = Join-Path $RepoRoot "frontend-electron"
$BackendBuild = Join-Path $RepoRoot "build\backend"

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "== $Name =="
    & $Action
}

Invoke-Step "Electron typecheck" {
    Push-Location $ElectronRoot
    try {
        npm run typecheck
    } finally {
        Pop-Location
    }
}

Invoke-Step "Electron unit and parity tests" {
    Push-Location $ElectronRoot
    try {
        npm test
    } finally {
        Pop-Location
    }
}

if (-not $SkipE2E) {
    Invoke-Step "Electron Playwright parity smoke" {
        Push-Location $ElectronRoot
        try {
            npm run test:e2e
        } finally {
            Pop-Location
        }
    }
}

if (-not $SkipBackend) {
    Invoke-Step "Backend FluxoraCoreTests build" {
        cmake --build $BackendBuild --config Debug --target FluxoraCoreTests
    }

    Invoke-Step "Backend CTest" {
        ctest --test-dir $BackendBuild -C Debug --output-on-failure
    }
}

if ($ReleaseSmoke) {
    Invoke-Step "Approved Windows installer release smoke" {
        & (Join-Path $RepoRoot "Build.ps1") -Configuration Release -Runtime win-x64

        $InstallerPath = Join-Path $RepoRoot "output-installer\FluxoraSetup.exe"
        if (-not (Test-Path -LiteralPath $InstallerPath)) {
            throw "Release smoke did not produce $InstallerPath"
        }
    }
}

Write-Host ""
Write-Host "Fluxora parity gate completed."
