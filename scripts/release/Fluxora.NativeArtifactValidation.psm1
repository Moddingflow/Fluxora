Set-StrictMode -Version Latest

# Official .NET apphosts contain this SHA-256 signature for ".net core bundle".
# The eight bytes immediately before it are zero in an unbundled apphost and are
# replaced with the bundle-header offset for a single-file publish.
[byte[]]$script:DotNetAppHostBundleSignature = @(
    0x8b, 0x12, 0x02, 0xb9, 0x6a, 0x61, 0x20, 0x38,
    0x72, 0x7b, 0x93, 0x02, 0x14, 0xd7, 0xa0, 0x32,
    0x13, 0xf5, 0xb9, 0xe6, 0xef, 0xae, 0x33, 0x18,
    0xee, 0x3b, 0x2d, 0xce, 0x24, 0xb3, 0x6a, 0xae
)

function Find-FluxoraBytePattern {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [byte[]]$Pattern
    )

    if ($Pattern.Length -eq 0) {
        throw 'A native-artifact byte pattern cannot be empty.'
    }

    $chunkSize = 4 * 1024 * 1024
    $buffer = [byte[]]::new($chunkSize + $Pattern.Length - 1)
    $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read)
    try {
        $carry = 0
        while ($true) {
            $read = $stream.Read($buffer, $carry, $chunkSize)
            $available = $carry + $read
            if ($available -ge $Pattern.Length) {
                $candidate = 0
                $lastCandidate = $available - $Pattern.Length
                while ($candidate -le $lastCandidate) {
                    while (
                        $candidate -le $lastCandidate -and
                        $buffer[$candidate] -ne $Pattern[0]
                    ) {
                        $candidate++
                    }
                    if ($candidate -gt $lastCandidate) {
                        break
                    }

                    $matches = $true
                    for ($index = 1; $index -lt $Pattern.Length; $index++) {
                        if ($buffer[$candidate + $index] -ne $Pattern[$index]) {
                            $matches = $false
                            break
                        }
                    }
                    if ($matches) {
                        return $true
                    }
                    $candidate++
                }
            }

            if ($read -eq 0) {
                return $false
            }

            $carry = [Math]::Min($Pattern.Length - 1, $available)
            if ($carry -gt 0) {
                [Array]::Copy($buffer, $available - $carry, $buffer, 0, $carry)
            }
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Convert-FluxoraPeRvaToFileOffset {
    param(
        [Parameter(Mandatory = $true)]
        [uint64]$Rva,

        [Parameter(Mandatory = $true)]
        [uint64]$SizeOfHeaders,

        [Parameter(Mandatory = $true)]
        [uint64]$FileLength,

        [Parameter(Mandatory = $true)]
        [object[]]$Sections,

        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ($Rva -lt $SizeOfHeaders -and $Rva -lt $FileLength) {
        return $Rva
    }

    foreach ($section in $Sections) {
        $mappedSize = [Math]::Max(
            [uint64]$section.VirtualSize,
            [uint64]$section.SizeOfRawData)
        $sectionStart = [uint64]$section.VirtualAddress
        $sectionEnd = $sectionStart + $mappedSize
        if ($Rva -lt $sectionStart -or $Rva -ge $sectionEnd) {
            continue
        }

        $delta = $Rva - $sectionStart
        if ($delta -ge [uint64]$section.SizeOfRawData) {
            throw "PE RVA 0x$($Rva.ToString('X')) maps outside raw section data in '$Path'."
        }
        $offset = [uint64]$section.PointerToRawData + $delta
        if ($offset -ge $FileLength) {
            throw "PE RVA 0x$($Rva.ToString('X')) maps outside '$Path'."
        }
        return $offset
    }

    throw "PE RVA 0x$($Rva.ToString('X')) cannot be mapped in '$Path'."
}

function Read-FluxoraPeAsciiString {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.BinaryReader]$Reader,

        [Parameter(Mandatory = $true)]
        [uint64]$Offset,

        [Parameter(Mandatory = $true)]
        [uint64]$FileLength,

        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ($Offset -ge $FileLength) {
        throw "PE string offset is outside '$Path'."
    }

    $Reader.BaseStream.Position = [long]$Offset
    $bytes = [Collections.Generic.List[byte]]::new()
    for ($index = 0; $index -lt 1024; $index++) {
        if ($Reader.BaseStream.Position -ge [long]$FileLength) {
            throw "PE import name is truncated in '$Path'."
        }
        $value = $Reader.ReadByte()
        if ($value -eq 0) {
            if ($bytes.Count -eq 0) {
                throw "PE import name is empty in '$Path'."
            }
            return [Text.Encoding]::ASCII.GetString($bytes.ToArray())
        }
        if ($value -gt 0x7f) {
            throw "PE import name is not ASCII in '$Path'."
        }
        $bytes.Add($value)
    }

    throw "PE import name exceeds the validation limit in '$Path'."
}

function Get-FluxoraPeInspection {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Native PE verification input does not exist: '$Path'."
    }

    $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read)
    $reader = [System.IO.BinaryReader]::new($stream)
    try {
        $fileLength = [uint64]$stream.Length
        if ($fileLength -lt 64 -or $reader.ReadUInt16() -ne 0x5A4D) {
            throw "File is not a valid PE image: '$Path'."
        }

        $stream.Position = 0x3C
        $peOffset = [uint64]$reader.ReadUInt32()
        if ($peOffset -gt ($fileLength - 24)) {
            throw "PE header is outside the file: '$Path'."
        }
        $stream.Position = [long]$peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) {
            throw "PE signature is invalid: '$Path'."
        }

        $machineType = $reader.ReadUInt16()
        $stream.Position = [long]($peOffset + 6)
        $sectionCount = [uint64]$reader.ReadUInt16()
        if ($sectionCount -eq 0 -or $sectionCount -gt 96) {
            throw "PE section count is invalid in '$Path'."
        }

        $stream.Position = [long]($peOffset + 20)
        $optionalHeaderSize = [uint64]$reader.ReadUInt16()
        $optionalHeaderOffset = $peOffset + 24
        if ($optionalHeaderSize -eq 0 -or
            $optionalHeaderOffset + $optionalHeaderSize -gt $fileLength) {
            throw "PE optional header is truncated: '$Path'."
        }

        $stream.Position = [long]$optionalHeaderOffset
        $optionalHeaderMagic = $reader.ReadUInt16()
        switch ($optionalHeaderMagic) {
            0x010B {
                $numberOfDirectoriesOffset = [uint64]92
                $dataDirectoriesOffset = [uint64]96
            }
            0x020B {
                $numberOfDirectoriesOffset = [uint64]108
                $dataDirectoriesOffset = [uint64]112
            }
            default {
                throw "Unsupported PE optional-header magic 0x$($optionalHeaderMagic.ToString('X4')) in '$Path'."
            }
        }

        if ($optionalHeaderSize -lt 64 -or
            $optionalHeaderSize -lt ($numberOfDirectoriesOffset + 4)) {
            throw "PE data-directory metadata is missing: '$Path'."
        }
        $stream.Position = [long]($optionalHeaderOffset + 60)
        $sizeOfHeaders = [uint64]$reader.ReadUInt32()
        $stream.Position = [long]($optionalHeaderOffset + $numberOfDirectoriesOffset)
        $numberOfDirectories = [uint64]$reader.ReadUInt32()

        $importRva = [uint64]0
        $importSize = [uint64]0
        if ($numberOfDirectories -gt 1) {
            if ($optionalHeaderSize -lt ($dataDirectoriesOffset + 16)) {
                throw "PE import data-directory entry is truncated: '$Path'."
            }
            $stream.Position = [long]($optionalHeaderOffset + $dataDirectoriesOffset + 8)
            $importRva = [uint64]$reader.ReadUInt32()
            $importSize = [uint64]$reader.ReadUInt32()
        }

        $hasClrMetadata = $false
        if ($numberOfDirectories -gt 14) {
            $clrDirectoryOffset = $dataDirectoriesOffset + (14 * 8)
            if ($optionalHeaderSize -lt ($clrDirectoryOffset + 8)) {
                throw "PE CLR data-directory entry is truncated: '$Path'."
            }
            $stream.Position = [long]($optionalHeaderOffset + $clrDirectoryOffset)
            $clrRva = $reader.ReadUInt32()
            $clrSize = $reader.ReadUInt32()
            $hasClrMetadata = $clrRva -ne 0 -or $clrSize -ne 0
        }

        $sectionTableOffset = $optionalHeaderOffset + $optionalHeaderSize
        if ($sectionTableOffset + ($sectionCount * 40) -gt $fileLength) {
            throw "PE section table is truncated: '$Path'."
        }
        $sections = [Collections.Generic.List[object]]::new()
        for ($index = 0; $index -lt $sectionCount; $index++) {
            $sectionOffset = $sectionTableOffset + ([uint64]$index * 40)
            $stream.Position = [long]($sectionOffset + 8)
            $sections.Add([pscustomobject]@{
                VirtualSize = [uint64]$reader.ReadUInt32()
                VirtualAddress = [uint64]$reader.ReadUInt32()
                SizeOfRawData = [uint64]$reader.ReadUInt32()
                PointerToRawData = [uint64]$reader.ReadUInt32()
            })
        }

        $imports = [Collections.Generic.List[string]]::new()
        if ($importRva -ne 0 -or $importSize -ne 0) {
            if ($importRva -eq 0 -or $importSize -lt 20) {
                throw "PE import data-directory is inconsistent in '$Path'."
            }
            $importOffset = Convert-FluxoraPeRvaToFileOffset `
                -Rva $importRva `
                -SizeOfHeaders $sizeOfHeaders `
                -FileLength $fileLength `
                -Sections $sections.ToArray() `
                -Path $Path
            $maximumDescriptors = [Math]::Min(
                [uint64]4096,
                [Math]::Max([uint64]1, [uint64]([Math]::Ceiling($importSize / 20.0))))
            $terminated = $false
            for ($index = [uint64]0; $index -lt $maximumDescriptors; $index++) {
                $descriptorOffset = $importOffset + ($index * 20)
                if ($descriptorOffset + 20 -gt $fileLength) {
                    throw "PE import descriptor is truncated in '$Path'."
                }
                $stream.Position = [long]$descriptorOffset
                $originalFirstThunk = $reader.ReadUInt32()
                $timeDateStamp = $reader.ReadUInt32()
                $forwarderChain = $reader.ReadUInt32()
                $nameRva = [uint64]$reader.ReadUInt32()
                $firstThunk = $reader.ReadUInt32()
                if ($originalFirstThunk -eq 0 -and
                    $timeDateStamp -eq 0 -and
                    $forwarderChain -eq 0 -and
                    $nameRva -eq 0 -and
                    $firstThunk -eq 0) {
                    $terminated = $true
                    break
                }
                if ($nameRva -eq 0) {
                    throw "PE import descriptor has no library name in '$Path'."
                }
                $nameOffset = Convert-FluxoraPeRvaToFileOffset `
                    -Rva $nameRva `
                    -SizeOfHeaders $sizeOfHeaders `
                    -FileLength $fileLength `
                    -Sections $sections.ToArray() `
                    -Path $Path
                $imports.Add((Read-FluxoraPeAsciiString `
                    -Reader $reader `
                    -Offset $nameOffset `
                    -FileLength $fileLength `
                    -Path $Path))
            }
            if (-not $terminated) {
                throw "PE import descriptor table is not terminated within its declared bounds in '$Path'."
            }
        }

        return [pscustomobject]@{
            HasClrMetadata = $hasClrMetadata
            ImportedLibraries = [string[]]$imports.ToArray()
            MachineType = [uint16]$machineType
        }
    }
    finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Assert-FluxoraNativePeImage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [uint16[]]$AllowedMachineTypes = @([uint16]0x8664),

        [switch]$RequireStaticMsvcRuntime
    )

    $inspection = Get-FluxoraPeInspection -Path $Path
    if ($AllowedMachineTypes.Count -eq 0 -or
        $AllowedMachineTypes -notcontains [uint16]$inspection.MachineType) {
        throw "PE machine type 0x$(([uint16]$inspection.MachineType).ToString('X4')) is forbidden in '$Path'."
    }
    if ($inspection.HasClrMetadata) {
        throw "Managed CLR metadata is forbidden in the Fluxora Windows artifact: '$Path'."
    }
    if (Find-FluxoraBytePattern -Path $Path -Pattern $script:DotNetAppHostBundleSignature) {
        throw ".NET apphost or single-file bundle markers are forbidden in the Fluxora Windows artifact: '$Path'."
    }

    $managedHostImports = @(
        $inspection.ImportedLibraries |
            Where-Object {
                $_ -match '(?i)^(?:coreclr|hostfxr|hostpolicy)\.dll$'
            }
    )
    if ($managedHostImports.Count -ne 0) {
        throw "Forbidden managed-host import in '$Path': $($managedHostImports -join ', ')."
    }

    if ($RequireStaticMsvcRuntime) {
        $dynamicMsvcImports = @(
            $inspection.ImportedLibraries |
                Where-Object {
                    $_ -match '(?i)^(?:msvcp140|vcruntime140|concrt140)(?:_[a-z0-9]+)*\.dll$'
                }
        )
        if ($dynamicMsvcImports.Count -ne 0) {
            throw "Dynamic MSVC runtime import is forbidden in the self-contained Fluxora executable '$Path': $($dynamicMsvcImports -join ', ')."
        }
    }
}

function Assert-FluxoraNativePayload {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw "Native payload root does not exist: '$Root'."
    }

    $legacyFiles = @(
        Get-ChildItem -LiteralPath $Root -File -Recurse -Force |
            Where-Object {
                (
                    $_.Name -match '(?i)^(Fluxora\.(Installer|Updater)(\.Tests)?|ProcessProbe|SharpVectors)(\.|$)' -or
                    $_.Name -match '(?i)^(?:FluxoraInstallerCore|FluxoraUpdaterProcessProbe)(?:\.|$)'
                ) -and
                    -not [string]::Equals($_.Name, 'FluxoraUpdater.exe', [System.StringComparison]::OrdinalIgnoreCase)
            }
    )
    if ($legacyFiles.Count -ne 0) {
        throw "Legacy installer/update payload files are forbidden: $($legacyFiles.FullName -join ', ')."
    }

    $managedRuntimeFiles = @(
        Get-ChildItem -LiteralPath $Root -File -Recurse -Force |
            Where-Object {
                $_.Name -match '(?i)^(?:coreclr|hostfxr|hostpolicy|System\.Private\.CoreLib)\.dll$' -or
                    $_.Name -match '(?i)\.(?:deps|runtimeconfig)\.json$'
            }
    )
    if ($managedRuntimeFiles.Count -ne 0) {
        throw "Managed runtime files are forbidden in the Fluxora Windows payload: $($managedRuntimeFiles.FullName -join ', ')."
    }

    foreach ($peFile in @(
        Get-ChildItem -LiteralPath $Root -File -Recurse -Force |
            Where-Object { $_.Extension -in @('.exe', '.dll') }
    )) {
        $requiresStaticMsvcRuntime = [string]::Equals(
            $peFile.Name,
            'FluxoraUpdater.exe',
            [System.StringComparison]::OrdinalIgnoreCase)
        Assert-FluxoraNativePeImage `
            -Path $peFile.FullName `
            -RequireStaticMsvcRuntime:$requiresStaticMsvcRuntime
    }
}

Export-ModuleMember -Function @(
    'Assert-FluxoraNativePeImage',
    'Assert-FluxoraNativePayload'
)
