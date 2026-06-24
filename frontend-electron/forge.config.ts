import fs from 'node:fs/promises';
import path from 'node:path';

import type { ForgeArch, ForgeConfig, ForgePlatform } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const nativeResourcesRoot = process.env.FLUXORA_NATIVE_RESOURCES?.trim();

const pathExists = async (candidate: string): Promise<boolean> => {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
};

const nativeResourcesSource = async (
  platform: ForgePlatform,
  arch: ForgeArch
): Promise<string | null> => {
  if (!nativeResourcesRoot) {
    return null;
  }

  const root = path.resolve(nativeResourcesRoot);
  const candidates = [
    path.join(root, platform, arch),
    path.join(root, platform),
    root
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `FLUXORA_NATIVE_RESOURCES is set, but no native payload was found for ${platform}/${arch}.`
  );
};

const packageResourcesDirectory = (outputPath: string, platform: ForgePlatform): string =>
  platform === 'darwin'
    ? path.join(outputPath, 'Contents', 'Resources')
    : path.join(outputPath, 'resources');

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: 'app.fluxora.desktop',
    executableName: 'Fluxora',
    icon: '../Icons/Fluxora',
    name: 'Fluxora',
    protocols: [
      {
        name: 'Fluxora NXM links',
        schemes: ['nxm']
      }
    ]
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ['darwin', 'linux'])
  ],
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      const source = await nativeResourcesSource(packageResult.platform, packageResult.arch);
      if (!source) {
        return;
      }

      await Promise.all(
        packageResult.outputPaths.map(async (outputPath) => {
          const destination = path.join(
            packageResourcesDirectory(outputPath, packageResult.platform),
            'native'
          );
          await fs.rm(destination, { force: true, recursive: true });
          await fs.mkdir(destination, { recursive: true });
          await fs.cp(source, destination, { force: true, recursive: true });
        })
      );
    }
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main'
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload'
        }
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts'
        }
      ]
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};

export default config;
