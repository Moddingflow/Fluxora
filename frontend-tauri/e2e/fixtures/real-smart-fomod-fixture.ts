import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface ZipEntry {
  name: string;
  content: Buffer;
}

interface BridgeEnvelope<T> {
  result?: {
    ok: boolean;
    data: T;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export interface RealSmartFomodFixture<TInstaller = unknown> {
  archivePath: string;
  installer: TInstaller;
  dispose: () => Promise<void>;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (content: Buffer) => {
  let value = 0xffffffff;
  for (const byte of content) {
    value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const createStoredZip = (entries: ZipEntry[]) => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'), 'utf8');
    const checksum = crc32(entry.content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(entry.content.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, entry.content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.content.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + entry.content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
};

const createTes4Plugin = (masters: string[]) => {
  const records = masters.map((master) => {
    const value = Buffer.from(`${master}\0`, 'utf8');
    const record = Buffer.alloc(6);
    record.write('MAST', 0, 'ascii');
    record.writeUInt16LE(value.length, 4);
    return Buffer.concat([record, value]);
  });
  const payload = Buffer.concat(records);
  const header = Buffer.alloc(24);
  header.write('TES4', 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

const bridgeMeta = (operationId: string) => ({
  protocolVersion: '1.0',
  operationId,
  requestSource: 'playwright-real-fomod',
  appVersion: '0.0.0-test',
  platform: 'win32',
  arch: 'x64',
  locale: 'en-US'
});

const invokeBridge = async <T>(
  hostPath: string,
  environment: NodeJS.ProcessEnv,
  method: string,
  params: Record<string, unknown>,
  operationId: string
) => {
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id: operationId,
    method,
    params,
    meta: bridgeMeta(operationId)
  });
  const child = spawn(hostPath, [], {
    env: { ...process.env, ...environment },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(`${request}\n`);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  const responseLine = stdout.split(/\r?\n/u).find((line) => line.trim().length > 0);
  if (exitCode !== 0 || !responseLine) {
    throw new Error(`FluxoraBridgeHost failed for ${method}: exit=${exitCode}; stderr=${stderr}`);
  }
  const envelope = JSON.parse(responseLine) as BridgeEnvelope<T>;
  if (!envelope.result?.ok) {
    throw new Error(
      `FluxoraBridgeHost rejected ${method}: ${envelope.error?.code ?? 'unknown'} ${
        envelope.error?.message ?? ''
      }`
    );
  }
  return envelope.result.data;
};

const resolveBridgeHost = (repositoryRoot: string) => {
  const candidates = [
    path.join(repositoryRoot, 'build', 'backend', 'Debug', 'FluxoraBridgeHost.exe'),
    path.join(repositoryRoot, 'build', 'backend', 'Release', 'FluxoraBridgeHost.exe')
  ];
  const host = candidates
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
  if (!host) {
    throw new Error('Build FluxoraBridgeHost before running the real FOMOD Playwright fixture.');
  }
  return host;
};

export const createRealSmartFomodFixture = async <TInstaller>(
  repositoryRoot: string
): Promise<RealSmartFomodFixture<TInstaller>> => {
  const root = await mkdtemp(path.join(tmpdir(), 'fluxora-smart-fomod-e2e-'));
  const appData = path.join(root, 'AppData');
  const appRoot = path.join(root, 'AppRoot');
  const gameDirectory = path.join(root, 'Skyrim Special Edition');
  const installRoot = path.join(root, 'Builds');
  const projectName = 'Smart FOMOD Playwright Build';
  const projectDirectory = path.join(installRoot, projectName);
  const archivePath = path.join(appRoot, 'Downloads', 'skyrimse', 'Smart Playwright.zip');
  const logDirectory = path.join(root, 'logs');
  const environment = {
    APPDATA: appData,
    FLUXORA_APP_ROOT: appRoot,
    FLUXORA_LOG_DIR: logDirectory,
    FLUXORA_OPERATION_CANCEL_DIR: path.join(root, 'operation-cancel')
  };

  try {
    await mkdir(path.join(gameDirectory, 'Data'), { recursive: true });
    await mkdir(path.dirname(archivePath), { recursive: true });
    await mkdir(appData, { recursive: true });
    await mkdir(installRoot, { recursive: true });
    await writeFile(path.join(gameDirectory, 'SkyrimSE.exe'), 'MZ executable stub');
    await writeFile(path.join(gameDirectory, 'Data', 'Skyrim.esm'), 'master');

    const moduleConfig = `
<config>
  <moduleName>Smart Playwright Mod</moduleName>
  <installSteps order="Explicit"><installStep name="Patches"><optionalFileGroups order="Explicit">
    <group name="Patches" type="SelectAny"><plugins order="Explicit"><plugin name="Lux Patch">
      <files><file source="payload/LuxPatch.esp" destination="Data/LuxPatch.esp" /></files>
      <typeDescriptor><type name="Recommended" /></typeDescriptor>
    </plugin></plugins></group>
  </optionalFileGroups></installStep></installSteps>
</config>`;
    await writeFile(
      archivePath,
      createStoredZip([
        { name: 'fomod/ModuleConfig.xml', content: Buffer.from(moduleConfig, 'utf8') },
        {
          name: 'fomod/info.xml',
          content: Buffer.from(
            '<fomod><Name>Smart Playwright Mod</Name><Version>1.0</Version></fomod>',
            'utf8'
          )
        },
        {
          name: 'payload/LuxPatch.esp',
          content: createTes4Plugin(['Skyrim.esm', 'Lux.esp'])
        }
      ])
    );

    const hostPath = resolveBridgeHost(repositoryRoot);
    await invokeBridge(
      hostPath,
      environment,
      'projects.create',
      {
        projectName,
        templateId: 'skyrimse',
        gamePath: gameDirectory,
        installRootDirectory: installRoot
      },
      'real_fomod_create_project'
    );
    await invokeBridge(
      hostPath,
      environment,
      'mods.createEmpty',
      { projectDirectory, modName: 'Lux' },
      'real_fomod_create_lux'
    );
    await writeFile(path.join(projectDirectory, 'mods', 'Lux', 'Lux.esp'), 'plugin');
    await mkdir(path.join(projectDirectory, 'profiles', 'Default'), { recursive: true });
    await writeFile(path.join(projectDirectory, 'profiles', 'Default', 'plugins.txt'), '*Lux.esp\n');

    const installer = await invokeBridge<TInstaller>(
      hostPath,
      environment,
      'downloads.analyzeFomod',
      {
        projectDirectory,
        downloadPath: archivePath,
        profileName: 'Default',
        manualDecisionsJson: '[]'
      },
      'real_fomod_analyze'
    );
    return {
      archivePath,
      installer,
      dispose: () => rm(root, { force: true, recursive: true })
    };
  } catch (error) {
    await rm(root, { force: true, recursive: true });
    throw error;
  }
};
