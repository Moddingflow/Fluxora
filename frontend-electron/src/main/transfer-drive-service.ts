import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

import type {
  FluxoraTransferDriveKind,
  FluxoraTransferDriveOption
} from '../shared/fluxora-api';
import type { ElectronLogService } from './logging';

const execFileAsync = promisify(execFile);
const cacheTtlMs = 30_000;

interface DriveCache {
  drives: FluxoraTransferDriveOption[];
  refreshedAt: number;
}

interface RawWindowsDrive {
  DriveLetter?: unknown;
  VolumeName?: unknown;
  FileSystem?: unknown;
  DriveType?: unknown;
  Size?: unknown;
  FreeSpace?: unknown;
  MediaType?: unknown;
  BusType?: unknown;
  FriendlyName?: unknown;
  IsBoot?: unknown;
  IsSystem?: unknown;
}

let driveCache: DriveCache | null = null;
let pendingRefresh: Promise<FluxoraTransferDriveOption[]> | null = null;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();

const numberValue = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const operationIdFromRequest = (rawRequest: unknown): string | undefined => {
  if (!rawRequest || typeof rawRequest !== 'object') {
    return undefined;
  }

  const candidate = rawRequest as { operationId?: unknown };
  return typeof candidate.operationId === 'string' && candidate.operationId.trim()
    ? candidate.operationId.trim()
    : undefined;
};

export const transferDriveKindFromMetadata = (
  mediaType: string,
  busType: string,
  driveType = ''
): FluxoraTransferDriveKind => {
  const media = mediaType.toLowerCase();
  const bus = busType.toLowerCase();
  const drive = driveType.toLowerCase();
  if (drive.includes('removable')) {
    return 'removable';
  }
  if (drive.includes('network')) {
    return 'network';
  }
  if (bus.includes('nvme')) {
    return 'nvme';
  }
  if (media.includes('ssd')) {
    return 'ssd';
  }
  if (media.includes('hdd') || media.includes('hard')) {
    return 'hdd';
  }
  return 'unknown';
};

export const transferDriveMediaLabel = (
  kind: FluxoraTransferDriveKind,
  busType: string,
  mediaType: string
): string => {
  if (kind === 'nvme') {
    return 'NVMe M.2';
  }
  if (kind === 'ssd') {
    return 'SSD';
  }
  if (kind === 'hdd') {
    return 'HDD';
  }
  if (kind === 'removable') {
    return 'USB';
  }
  if (kind === 'network') {
    return 'Network';
  }

  return textValue(mediaType) || textValue(busType) || 'Drive';
};

const toDriveOption = (raw: RawWindowsDrive): FluxoraTransferDriveOption | null => {
  const driveLetter = textValue(raw.DriveLetter).replace(':', '').toUpperCase();
  if (!/^[A-Z]$/.test(driveLetter)) {
    return null;
  }

  const rootPath = `${driveLetter}:\\`;
  const volumeName = textValue(raw.VolumeName);
  const busType = textValue(raw.BusType);
  const mediaType = textValue(raw.MediaType);
  const driveType = textValue(raw.DriveType);
  const driveKind = transferDriveKindFromMetadata(mediaType, busType, driveType);
  const mediaLabel = transferDriveMediaLabel(driveKind, busType, mediaType);
  const displayName = volumeName || 'Локальный диск';

  return {
    id: rootPath,
    rootPath,
    label: `${displayName} (${driveLetter}:)`,
    volumeName,
    fileSystem: textValue(raw.FileSystem),
    totalBytes: numberValue(raw.Size),
    availableBytes: numberValue(raw.FreeSpace),
    driveKind,
    mediaLabel,
    busType,
    friendlyName: textValue(raw.FriendlyName),
    isSystem: Boolean(raw.IsBoot) || Boolean(raw.IsSystem) || driveLetter === 'C'
  };
};

const windowsDriveScript = `
$ErrorActionPreference = 'SilentlyContinue'
$physicalById = @{}
Get-PhysicalDisk | ForEach-Object { $physicalById[[string]$_.DeviceId] = $_ }
Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -in @('Fixed','Removable') } | ForEach-Object {
  $partition = Get-Partition -DriveLetter $_.DriveLetter
  $disk = $partition | Get-Disk
  $physical = $physicalById[[string]$disk.Number]
  $mediaType = if ($physical -and $physical.MediaType) { $physical.MediaType } else { $disk.MediaType }
  $busType = if ($physical -and $physical.BusType) { $physical.BusType } else { $disk.BusType }
  $friendlyName = if ($physical -and $physical.FriendlyName) { $physical.FriendlyName } else { $disk.FriendlyName }
  [pscustomobject]@{
    DriveLetter = [string]$_.DriveLetter
    VolumeName = [string]$_.FileSystemLabel
    FileSystem = [string]$_.FileSystem
    DriveType = [string]$_.DriveType
    Size = [double]$_.Size
    FreeSpace = [double]$_.SizeRemaining
    MediaType = [string]$mediaType
    BusType = [string]$busType
    FriendlyName = [string]$friendlyName
    IsBoot = [bool]$partition.IsBoot
    IsSystem = [bool]$partition.IsSystem
  }
} | ConvertTo-Json -Compress
`;

const listWindowsDrives = async (): Promise<FluxoraTransferDriveOption[]> => {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', windowsDriveScript],
    {
      maxBuffer: 1024 * 1024,
      timeout: 4000,
      windowsHide: true
    }
  );
  const parsed = JSON.parse(stdout || '[]') as RawWindowsDrive | RawWindowsDrive[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .map(toDriveOption)
    .filter((drive): drive is FluxoraTransferDriveOption => drive !== null)
    .sort((left, right) => left.rootPath.localeCompare(right.rootPath));
};

const statRoot = async (rootPath: string): Promise<FluxoraTransferDriveOption | null> => {
  try {
    const stats = await fs.statfs(rootPath);
    const totalBytes = stats.blocks * stats.bsize;
    const availableBytes = stats.bavail * stats.bsize;
    return {
      id: rootPath,
      rootPath,
      label: process.platform === 'win32' ? `Локальный диск (${rootPath.slice(0, 2)})` : rootPath,
      volumeName: '',
      fileSystem: '',
      totalBytes,
      availableBytes,
      driveKind: 'unknown',
      mediaLabel: 'Drive',
      busType: '',
      friendlyName: '',
      isSystem: process.platform === 'win32' ? rootPath.toUpperCase().startsWith('C:') : rootPath === '/'
    };
  } catch {
    return null;
  }
};

const listFallbackDrives = async (): Promise<FluxoraTransferDriveOption[]> => {
  const roots =
    process.platform === 'win32'
      ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`)
      : ['/'];
  const results = await Promise.all(roots.map((root) => statRoot(root)));
  return results
    .filter((drive): drive is FluxoraTransferDriveOption => drive !== null)
    .sort((left, right) => left.rootPath.localeCompare(right.rootPath));
};

const refreshDrives = async (
  logs: ElectronLogService | null,
  rawRequest?: unknown
): Promise<FluxoraTransferDriveOption[]> => {
  const operationId = operationIdFromRequest(rawRequest);
  try {
    const drives = process.platform === 'win32' ? await listWindowsDrives() : await listFallbackDrives();
    driveCache = { drives, refreshedAt: Date.now() };
    void logs?.write('main-bridge', 'debug', 'TransferDrives', `listed ${drives.length} destination drives`, operationId);
    return drives;
  } catch (error) {
    void logs?.write(
      'main-bridge',
      'warning',
      'TransferDrives',
      `drive metadata fallback: ${error instanceof Error ? error.message : String(error)}`,
      operationId
    );
    const drives = await listFallbackDrives();
    driveCache = { drives, refreshedAt: Date.now() };
    return drives;
  } finally {
    pendingRefresh = null;
  }
};

export const listTransferDestinationDrives = async (
  logs: ElectronLogService | null,
  rawRequest?: unknown
): Promise<FluxoraTransferDriveOption[]> => {
  if (driveCache && Date.now() - driveCache.refreshedAt < cacheTtlMs) {
    return driveCache.drives;
  }

  pendingRefresh ??= refreshDrives(logs, rawRequest);
  return pendingRefresh;
};

export const prewarmTransferDestinationDrives = (logs: ElectronLogService | null): void => {
  if (pendingRefresh || driveCache) {
    return;
  }

  pendingRefresh = refreshDrives(logs);
};
