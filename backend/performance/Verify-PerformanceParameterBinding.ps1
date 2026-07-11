[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$HarnessPath,

    [string]$WorkRoot = ''
)

$ErrorActionPreference = 'Stop'
$resolvedHarness = (Resolve-Path -LiteralPath $HarnessPath -ErrorAction Stop).Path
$engine = (Get-Process -Id $PID).Path

function Assert-Counts {
    param(
        [Parameter(Mandatory)]
        [string]$Argument,
        [Parameter(Mandatory)]
        [int[]]$Expected
    )

    $output = & $engine -NoProfile -File $resolvedHarness `
        -HostPath unused `
        -FixtureBuilderPath unused `
        -ProbePath unused `
        -ResultPath unused `
        -ModCounts $Argument `
        -ValidateParametersOnly 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Parameter validation subprocess failed: $($output -join [Environment]::NewLine)"
    }

    $settings = ($output -join [Environment]::NewLine) | ConvertFrom-Json
    $actual = @($settings.modCounts)
    if ($actual.Count -ne $Expected.Count) {
        throw "Expected $($Expected.Count) counts, received $($actual.Count): $($actual -join ', ')"
    }
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        if ([int]$actual[$index] -ne $Expected[$index]) {
            throw "Expected '$($Expected -join ', ')', received '$($actual -join ', ')'."
        }
    }
}

Assert-Counts -Argument '1500,3000' -Expected @(1500, 3000)
Assert-Counts -Argument '610,1500,3000' -Expected @(610, 1500, 3000)

if ([string]::IsNullOrWhiteSpace($WorkRoot)) {
    $WorkRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'fluxora-performance-lock-smoke'
}
$resolvedWorkRoot = [System.IO.Path]::GetFullPath($WorkRoot)
[System.IO.Directory]::CreateDirectory($resolvedWorkRoot) | Out-Null
$lockPath = Join-Path $resolvedWorkRoot '.fluxora-performance.lock'
$heldLock = [System.IO.File]::Open(
    $lockPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None)
try {
    $contentionOutput = & $engine -NoProfile -File $resolvedHarness `
        -HostPath unused `
        -FixtureBuilderPath unused `
        -ProbePath unused `
        -ResultPath unused `
        -WorkRoot $resolvedWorkRoot 2>&1
    $contentionExitCode = $LASTEXITCODE
}
finally {
    $heldLock.Dispose()
}

$contentionMessage = $contentionOutput -join [Environment]::NewLine
if ($contentionExitCode -eq 0) {
    throw 'The performance harness accepted a WorkRoot already locked by another process.'
}
if ($contentionMessage -notlike '*already in use by another performance run*' -or
    $contentionMessage -notlike "*$resolvedWorkRoot*") {
    throw "The performance harness did not report clear WorkRoot lock contention: $contentionMessage"
}

Write-Output 'Performance parameter binding and WorkRoot locking verified.'
