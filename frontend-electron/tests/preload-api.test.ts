import { describe, expect, it } from 'vitest';

import { createFluxoraApi } from '../src/preload/fluxora-api';
import { FluxoraIpcChannels, type FluxoraIpcChannel } from '../src/shared/fluxora-api';

describe('preload API shape', () => {
  it('exposes only typed allowlisted groups', () => {
    const api = createFluxoraApi({
      invoke: async () => ({})
    });

    expect(Object.keys(api).sort()).toEqual([
      'app',
      'archives',
      'bridge',
      'buildPaths',
      'dialogs',
      'downloads',
      'executables',
      'fluxPack',
      'links',
      'mods',
      'nexus',
      'nxm',
      'operations',
      'plugins',
      'profiles',
      'projects',
      'security',
      'settings',
      'shell',
      'templates',
      'transfer',
      'ui',
      'windowControls'
    ]);
    expect(Object.keys(api.app)).toEqual(['getInfo']);
    expect(Object.keys(api.bridge)).toEqual(['getStatus', 'getLanguage', 'setLanguage', 'shutdown']);
    expect(Object.keys(api.dialogs)).toEqual([
      'pickArchive',
      'pickBuildConfig',
      'pickExecutable',
      'pickFluxPack',
      'pickFolder',
      'saveFluxPack'
    ]);
    expect(Object.keys(api.links)).toEqual(['openExternal']);
    expect(Object.keys(api.mods)).toEqual([
      'listInstalled',
      'getOrder',
      'createSeparator',
      'deleteSeparator',
      'moveOrderItem',
      'deleteInstalled',
      'createEmpty',
      'setEnabled',
      'setAllEnabled',
      'checkUpdates',
      'getFileTree'
    ]);
    expect(Object.keys(api.plugins)).toEqual([
      'list',
      'createSeparator',
      'deleteSeparator',
      'move',
      'setEnabled'
    ]);
    expect(Object.keys(api.profiles)).toEqual([
      'list',
      'create',
      'clone',
      'rename',
      'delete'
    ]);
    expect(Object.keys(api.executables)).toEqual([
      'list',
      'save',
      'launch',
      'getIcon'
    ]);
    expect(Object.keys(api.downloads)).toEqual([
      'list',
      'importFile',
      'delete',
      'cancel',
      'resume',
      'analyzeContentLayout',
      'analyzeFomod',
      'analyzeFomodContentLayout',
      'install',
      'installFomod'
    ]);
    expect(Object.keys(api.archives)).toEqual(['install', 'installFomod']);
    expect(Object.keys(api.nxm)).toEqual([
      'registerProtocol',
      'captureLinks',
      'importInboundDownloads'
    ]);
    expect(Object.keys(api.nexus)).toEqual(['getAuthStatus', 'connect', 'disconnect']);
    expect(Object.keys(api.settings)).toEqual([
      'getLanguage',
      'setLanguage',
      'getTheme',
      'setTheme'
    ]);
    expect(Object.keys(api.transfer)).toEqual([
      'analyzeMo2',
      'importMo2',
      'listDestinationDrives',
      'startMo2InMain',
      'openMo2InMain',
      'onMo2Handoff',
      'onMo2Open'
    ]);
    expect(Object.keys(api.buildPaths)).toEqual(['get', 'save']);
    expect(Object.keys(api.fluxPack)).toEqual(['export', 'inspect', 'install']);
    expect(Object.keys(api.operations)).toEqual(['cancel', 'onProgress']);
    expect(Object.keys(api.projects)).toEqual([
      'list',
      'openConfig',
      'previewDirectory',
      'create',
      'rename',
      'delete'
    ]);
    expect(Object.keys(api.security)).toEqual(['getState']);
    expect(Object.keys(api.shell)).toEqual(['openPath', 'showItemInFolder']);
    expect(Object.keys(api.templates)).toEqual(['list', 'resolve']);
    expect(Object.keys(api.ui)).toEqual(['log']);
    expect(Object.keys(api.windowControls)).toEqual(['close', 'minimize', 'openSettings', 'toggleMaximize']);
  });

  it('routes renderer calls through the allowlisted IPC channels', async () => {
    const calls: Array<{ channel: FluxoraIpcChannel; args: unknown[] }> = [];
    const api = createFluxoraApi({
      invoke: async (channel, ...args) => {
        calls.push({ channel, args });
        return {};
      }
    });

    await api.app.getInfo();
    await api.security.getState();
    await api.links.openExternal('https://fluxora.local');
    await api.mods.listInstalled('C:\\Builds\\Skyrim', { operationId: 'op_test_mods_list' });
    await api.mods.getOrder('C:\\Builds\\Skyrim', 'Default', { operationId: 'op_test_mods_order' });
    await api.mods.createSeparator('C:\\Builds\\Skyrim', 'Default', 'Visuals', 2, {
      operationId: 'op_test_mods_separator_create'
    });
    await api.mods.deleteSeparator('C:\\Builds\\Skyrim', 'Default', 'sep_visuals', {
      operationId: 'op_test_mods_separator_delete'
    });
    await api.mods.moveOrderItem('C:\\Builds\\Skyrim', 'Default', 'mod_skyui', 1, {
      operationId: 'op_test_mods_move'
    });
    await api.mods.deleteInstalled('C:\\Builds\\Skyrim', 'C:\\Builds\\Skyrim\\mods\\SkyUI', {
      operationId: 'op_test_mods_delete'
    });
    await api.mods.createEmpty('C:\\Builds\\Skyrim', 'Generated Output', {
      operationId: 'op_test_mods_create_empty'
    });
    await api.mods.setEnabled(
      'C:\\Builds\\Skyrim',
      'C:\\Builds\\Skyrim\\mods\\SkyUI',
      false,
      { operationId: 'op_test_mods_enabled' }
    );
    await api.mods.setAllEnabled('C:\\Builds\\Skyrim', true, {
      operationId: 'op_test_mods_all_enabled'
    });
    await api.mods.checkUpdates('C:\\Builds\\Skyrim', {
      operationId: 'op_test_mods_updates'
    });
    await api.mods.getFileTree(
      'C:\\Builds\\Skyrim',
      'C:\\Builds\\Skyrim\\mods\\SkyUI',
      'interface',
      { operationId: 'op_test_mods_tree' }
    );
    await api.plugins.list('C:\\Builds\\Skyrim', 'skyrimse', 'Default', {
      operationId: 'op_test_plugins_list'
    });
    await api.plugins.createSeparator('C:\\Builds\\Skyrim', 'skyrimse', 'Default', 'Late patches', 3, {
      operationId: 'op_test_plugins_separator_create'
    });
    await api.plugins.deleteSeparator('C:\\Builds\\Skyrim', 'skyrimse', 'Default', 'sep_plugins', {
      operationId: 'op_test_plugins_separator_delete'
    });
    await api.plugins.move('C:\\Builds\\Skyrim', 'skyrimse', 'Default', 'plugin_skyui', 1, {
      operationId: 'op_test_plugins_move'
    });
    await api.plugins.setEnabled('C:\\Builds\\Skyrim', 'skyrimse', 'Default', 'SkyUI.esp', false, {
      operationId: 'op_test_plugins_enabled'
    });
    await api.profiles.list('C:\\Builds\\Skyrim', 'Default', {
      operationId: 'op_test_profiles_list'
    });
    await api.profiles.create('C:\\Builds\\Skyrim', 'Testing', 'Default', ['plugins.txt'], {
      operationId: 'op_test_profiles_create'
    });
    await api.profiles.clone('C:\\Builds\\Skyrim', 'Testing', 'Testing Copy', 'Default', {
      operationId: 'op_test_profiles_clone'
    });
    await api.profiles.rename('C:\\Builds\\Skyrim', 'Testing Copy', 'Renamed', 'Default', {
      operationId: 'op_test_profiles_rename'
    });
    await api.profiles.delete('C:\\Builds\\Skyrim', 'Renamed', 'Default', {
      operationId: 'op_test_profiles_delete'
    });
    await api.executables.list('C:\\Builds\\Skyrim.json', {
      operationId: 'op_test_executables_list'
    });
    await api.executables.save(
      'C:\\Builds\\Skyrim.json',
      [
        {
          id: 'skse',
          displayName: 'SKSE',
          executablePath: 'C:\\Games\\Skyrim\\skse64_loader.exe',
          arguments: '-forcesteamloader',
          workingDirectory: 'C:\\Games\\Skyrim',
          iconPath: ''
        }
      ],
      { operationId: 'op_test_executables_save' }
    );
    await api.executables.launch('C:\\Builds\\Skyrim.json', 'skse', 'Default', {
      operationId: 'op_test_executables_launch'
    });
    await api.executables.getIcon('C:\\Games\\Skyrim\\skse64_loader.exe', {
      operationId: 'op_test_executables_icon'
    });
    await api.downloads.list('C:\\Builds\\Skyrim', { operationId: 'op_test_downloads_list' });
    await api.downloads.importFile('C:\\Builds\\Skyrim', 'C:\\Archives\\SkyUI.7z', {
      operationId: 'op_test_downloads_import'
    });
    await api.downloads.cancel('C:\\Builds\\Skyrim', 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z', {
      operationId: 'op_test_downloads_cancel'
    });
    await api.downloads.resume('C:\\Builds\\Skyrim', 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z', {
      operationId: 'op_test_downloads_resume'
    });
    await api.downloads.analyzeContentLayout(
      {
        projectDirectory: 'C:\\Builds\\Skyrim',
        downloadPath: 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
        existingModMode: 0
      },
      { operationId: 'op_test_downloads_layout' }
    );
    await api.downloads.analyzeFomod(
      'C:\\Builds\\Skyrim',
      'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
      { operationId: 'op_test_downloads_fomod' }
    );
    await api.downloads.analyzeFomodContentLayout(
      {
        projectDirectory: 'C:\\Builds\\Skyrim',
        downloadPath: 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
        existingModMode: 0,
        selectedOptionIds: ['core']
      },
      { operationId: 'op_test_downloads_fomod_layout' }
    );
    await api.downloads.install(
      {
        projectDirectory: 'C:\\Builds\\Skyrim',
        downloadPath: 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
        modName: 'SkyUI',
        existingModMode: 0
      },
      { operationId: 'op_test_downloads_install' }
    );
    await api.downloads.installFomod(
      {
        projectDirectory: 'C:\\Builds\\Skyrim',
        downloadPath: 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
        modName: 'SkyUI',
        existingModMode: 1,
        selectedOptionIds: ['core']
      },
      { operationId: 'op_test_downloads_install_fomod' }
    );
    await api.archives.install(
      {
        projectDirectory: 'C:\\Builds\\Skyrim',
        archivePath: 'C:\\Archives\\SkyUI.7z',
        modName: 'SkyUI',
        existingModMode: 0
      },
      { operationId: 'op_test_archives_install' }
    );
    await api.archives.installFomod(
      {
        projectDirectory: 'C:\\Builds\\Skyrim',
        archivePath: 'C:\\Archives\\SkyUI.7z',
        modName: 'SkyUI',
        existingModMode: 2,
        selectedOptionIds: ['core']
      },
      { operationId: 'op_test_archives_install_fomod' }
    );
    await api.downloads.delete('C:\\Builds\\Skyrim', 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z', {
      operationId: 'op_test_downloads_delete'
    });
    await api.nxm.registerProtocol({ operationId: 'op_test_nxm_register' });
    await api.nxm.captureLinks('C:\\Builds\\Skyrim', ['nxm://skyrimspecialedition/mods/3863/files/123'], {
      operationId: 'op_test_nxm_capture'
    });
    await api.nxm.importInboundDownloads('C:\\Builds\\Skyrim', {
      operationId: 'op_test_nxm_import_inbound'
    });
    await api.nexus.getAuthStatus({ operationId: 'op_test_nexus_status' });
    await api.nexus.connect({ operationId: 'op_test_nexus_connect' });
    await api.nexus.disconnect({ operationId: 'op_test_nexus_disconnect' });
    await api.settings.getLanguage({ operationId: 'op_test_settings_language_get' });
    await api.settings.setLanguage('de-de', { operationId: 'op_test_settings_language_set' });
    await api.settings.getTheme({ operationId: 'op_test_settings_theme_get' });
    await api.settings.setTheme('light', { operationId: 'op_test_settings_theme_set' });
    await api.transfer.analyzeMo2(
      'C:\\MO2',
      'C:\\Fluxora\\Builds',
      'C:\\Builds\\Skyrim.json',
      { operationId: 'op_test_transfer_analyze' }
    );
    await api.transfer.importMo2(
      {
        sourceDirectory: 'C:\\MO2',
        destinationRootDirectory: 'C:\\Fluxora\\Builds',
        existingConfigPath: 'C:\\Builds\\Skyrim.json',
        replaceExisting: true
      },
      { operationId: 'op_test_transfer_import' }
    );
    await api.transfer.listDestinationDrives({ operationId: 'op_test_transfer_drives' });
    await api.transfer.startMo2InMain({
      request: {
        sourceDirectory: 'C:\\MO2',
        destinationRootDirectory: 'C:\\Fluxora\\Builds',
        existingConfigPath: 'C:\\Builds\\Skyrim.json',
        replaceExisting: true
      }
    });
    await api.transfer.openMo2InMain();
    await api.buildPaths.get('C:\\Builds\\Skyrim.json', {
      operationId: 'op_test_build_paths_get'
    });
    await api.buildPaths.save(
      'C:\\Builds\\Skyrim.json',
      {
        gameDirectory: 'C:\\Games\\Skyrim',
        modsDirectory: 'C:\\Builds\\Skyrim\\mods',
        profilesDirectory: 'C:\\Builds\\Skyrim\\profiles',
        downloadsDirectory: 'C:\\Builds\\Skyrim\\downloads',
        overwriteDirectory: 'C:\\Builds\\Skyrim\\overwrite'
      },
      { operationId: 'op_test_build_paths_save' }
    );
    await api.fluxPack.export(
      {
        configPath: 'C:\\Builds\\Skyrim.json',
        outputPath: 'C:\\Packs\\Skyrim.fluxpack',
        includeGeneratedAssets: true
      },
      { operationId: 'op_test_fluxpack_export' }
    );
    await api.fluxPack.inspect('C:\\Packs\\Skyrim.fluxpack', {
      operationId: 'op_test_fluxpack_inspect'
    });
    await api.fluxPack.install(
      {
        fluxPackPath: 'C:\\Packs\\Skyrim.fluxpack',
        installRootDirectory: 'C:\\Fluxora\\Builds'
      },
      { operationId: 'op_test_fluxpack_install' }
    );
    await api.operations.cancel('op_test_transfer_import', {
      operationId: 'op_test_operations_cancel'
    });
    await api.shell.openPath('C:\\Fluxora');
    await api.shell.showItemInFolder('C:\\Fluxora\\Downloads\\SkyUI.7z');
    await api.dialogs.pickArchive('C:\\Fluxora\\Downloads');
    await api.dialogs.pickBuildConfig('C:\\Users\\Test\\AppData\\Roaming\\Fluxora\\Builds');
    await api.dialogs.pickExecutable('Pick game', 'C:\\Games\\Skyrim\\SkyrimSE.exe');
    await api.dialogs.pickFluxPack('C:\\Packs');
    await api.dialogs.pickFolder('Pick builds', 'C:\\Users\\Test\\AppData\\Roaming\\Fluxora\\Projects');
    await api.dialogs.saveFluxPack('C:\\Packs\\Skyrim.fluxpack', 'Save package');
    await api.bridge.getStatus({ operationId: 'op_test_status' });
    await api.bridge.getLanguage({ operationId: 'op_test_language_get' });
    await api.bridge.setLanguage('ru-ru', { operationId: 'op_test_language_set' });
    await api.bridge.shutdown({ operationId: 'op_test_shutdown' });
    await api.templates.list({ operationId: 'op_test_templates' });
    await api.templates.resolve('skyrim-special-edition', { operationId: 'op_test_template_resolve' });
    await api.projects.list({ operationId: 'op_test_projects' });
    await api.projects.openConfig('C:\\Builds\\Skyrim.json', { operationId: 'op_test_open' });
    await api.projects.previewDirectory('Skyrim Build', 'C:\\Builds', {
      operationId: 'op_test_preview'
    });
    await api.projects.create(
      {
        projectName: 'Skyrim Build',
        templateId: 'skyrim-special-edition',
        gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
        installRootDirectory: 'C:\\Builds'
      },
      { operationId: 'op_test_create' }
    );
    await api.projects.rename('C:\\Builds\\Skyrim.json', 'Skyrim Modded', {
      operationId: 'op_test_rename'
    });
    await api.projects.delete('C:\\Builds\\Skyrim.json', { operationId: 'op_test_delete' });
    await api.ui.log({
      level: 'info',
      message: 'hello',
      operationId: 'op_test_ui'
    });
    await api.windowControls.minimize();
    await api.windowControls.openSettings();
    await api.windowControls.toggleMaximize();
    await api.windowControls.close();

    expect(calls).toEqual([
      { channel: FluxoraIpcChannels.appGetInfo, args: [] },
      { channel: FluxoraIpcChannels.securityGetState, args: [] },
      { channel: FluxoraIpcChannels.linksOpenExternal, args: ['https://fluxora.local'] },
      {
        channel: FluxoraIpcChannels.modsListInstalled,
        args: ['C:\\Builds\\Skyrim', { operationId: 'op_test_mods_list' }]
      },
      {
        channel: FluxoraIpcChannels.modsGetOrder,
        args: ['C:\\Builds\\Skyrim', 'Default', { operationId: 'op_test_mods_order' }]
      },
      {
        channel: FluxoraIpcChannels.modsCreateSeparator,
        args: [
          'C:\\Builds\\Skyrim',
          'Default',
          'Visuals',
          2,
          { operationId: 'op_test_mods_separator_create' }
        ]
      },
      {
        channel: FluxoraIpcChannels.modsDeleteSeparator,
        args: [
          'C:\\Builds\\Skyrim',
          'Default',
          'sep_visuals',
          { operationId: 'op_test_mods_separator_delete' }
        ]
      },
      {
        channel: FluxoraIpcChannels.modsMoveOrderItem,
        args: ['C:\\Builds\\Skyrim', 'Default', 'mod_skyui', 1, { operationId: 'op_test_mods_move' }]
      },
      {
        channel: FluxoraIpcChannels.modsDeleteInstalled,
        args: [
          'C:\\Builds\\Skyrim',
          'C:\\Builds\\Skyrim\\mods\\SkyUI',
          { operationId: 'op_test_mods_delete' }
        ]
      },
      {
        channel: FluxoraIpcChannels.modsCreateEmpty,
        args: [
          'C:\\Builds\\Skyrim',
          'Generated Output',
          { operationId: 'op_test_mods_create_empty' }
        ]
      },
      {
        channel: FluxoraIpcChannels.modsSetEnabled,
        args: [
          'C:\\Builds\\Skyrim',
          'C:\\Builds\\Skyrim\\mods\\SkyUI',
          false,
          { operationId: 'op_test_mods_enabled' }
        ]
      },
      {
        channel: FluxoraIpcChannels.modsSetAllEnabled,
        args: ['C:\\Builds\\Skyrim', true, { operationId: 'op_test_mods_all_enabled' }]
      },
      {
        channel: FluxoraIpcChannels.modsCheckUpdates,
        args: ['C:\\Builds\\Skyrim', { operationId: 'op_test_mods_updates' }]
      },
      {
        channel: FluxoraIpcChannels.modsGetFileTree,
        args: [
          'C:\\Builds\\Skyrim',
          'C:\\Builds\\Skyrim\\mods\\SkyUI',
          'interface',
          { operationId: 'op_test_mods_tree' }
        ]
      },
      {
        channel: FluxoraIpcChannels.pluginsList,
        args: ['C:\\Builds\\Skyrim', 'skyrimse', 'Default', { operationId: 'op_test_plugins_list' }]
      },
      {
        channel: FluxoraIpcChannels.pluginsCreateSeparator,
        args: [
          'C:\\Builds\\Skyrim',
          'skyrimse',
          'Default',
          'Late patches',
          3,
          { operationId: 'op_test_plugins_separator_create' }
        ]
      },
      {
        channel: FluxoraIpcChannels.pluginsDeleteSeparator,
        args: [
          'C:\\Builds\\Skyrim',
          'skyrimse',
          'Default',
          'sep_plugins',
          { operationId: 'op_test_plugins_separator_delete' }
        ]
      },
      {
        channel: FluxoraIpcChannels.pluginsMove,
        args: [
          'C:\\Builds\\Skyrim',
          'skyrimse',
          'Default',
          'plugin_skyui',
          1,
          { operationId: 'op_test_plugins_move' }
        ]
      },
      {
        channel: FluxoraIpcChannels.pluginsSetEnabled,
        args: [
          'C:\\Builds\\Skyrim',
          'skyrimse',
          'Default',
          'SkyUI.esp',
          false,
          { operationId: 'op_test_plugins_enabled' }
        ]
      },
      {
        channel: FluxoraIpcChannels.profilesList,
        args: ['C:\\Builds\\Skyrim', 'Default', { operationId: 'op_test_profiles_list' }]
      },
      {
        channel: FluxoraIpcChannels.profilesCreate,
        args: [
          'C:\\Builds\\Skyrim',
          'Testing',
          'Default',
          ['plugins.txt'],
          { operationId: 'op_test_profiles_create' }
        ]
      },
      {
        channel: FluxoraIpcChannels.profilesClone,
        args: [
          'C:\\Builds\\Skyrim',
          'Testing',
          'Testing Copy',
          'Default',
          { operationId: 'op_test_profiles_clone' }
        ]
      },
      {
        channel: FluxoraIpcChannels.profilesRename,
        args: [
          'C:\\Builds\\Skyrim',
          'Testing Copy',
          'Renamed',
          'Default',
          { operationId: 'op_test_profiles_rename' }
        ]
      },
      {
        channel: FluxoraIpcChannels.profilesDelete,
        args: ['C:\\Builds\\Skyrim', 'Renamed', 'Default', { operationId: 'op_test_profiles_delete' }]
      },
      {
        channel: FluxoraIpcChannels.executablesList,
        args: ['C:\\Builds\\Skyrim.json', { operationId: 'op_test_executables_list' }]
      },
      {
        channel: FluxoraIpcChannels.executablesSave,
        args: [
          'C:\\Builds\\Skyrim.json',
          [
            {
              id: 'skse',
              displayName: 'SKSE',
              executablePath: 'C:\\Games\\Skyrim\\skse64_loader.exe',
              arguments: '-forcesteamloader',
              workingDirectory: 'C:\\Games\\Skyrim',
              iconPath: ''
            }
          ],
          { operationId: 'op_test_executables_save' }
        ]
      },
      {
        channel: FluxoraIpcChannels.executablesLaunch,
        args: [
          'C:\\Builds\\Skyrim.json',
          'skse',
          'Default',
          { operationId: 'op_test_executables_launch' }
        ]
      },
      {
        channel: FluxoraIpcChannels.executablesGetIcon,
        args: [
          'C:\\Games\\Skyrim\\skse64_loader.exe',
          { operationId: 'op_test_executables_icon' }
        ]
      },
      {
        channel: FluxoraIpcChannels.downloadsList,
        args: ['C:\\Builds\\Skyrim', { operationId: 'op_test_downloads_list' }]
      },
      {
        channel: FluxoraIpcChannels.downloadsImportFile,
        args: [
          'C:\\Builds\\Skyrim',
          'C:\\Archives\\SkyUI.7z',
          { operationId: 'op_test_downloads_import' }
        ]
      },
      {
        channel: FluxoraIpcChannels.downloadsCancel,
        args: [
          'C:\\Builds\\Skyrim',
          'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
          { operationId: 'op_test_downloads_cancel' }
        ]
      },
      {
        channel: FluxoraIpcChannels.downloadsResume,
        args: [
          'C:\\Builds\\Skyrim',
          'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
          { operationId: 'op_test_downloads_resume' }
        ]
      },
      {
        channel: FluxoraIpcChannels.downloadsAnalyzeContentLayout,
        args: [
          {
            projectDirectory: 'C:\\Builds\\Skyrim',
            downloadPath: 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
            existingModMode: 0
          },
          { operationId: 'op_test_downloads_layout' }
        ]
      },
      {
        channel: FluxoraIpcChannels.downloadsAnalyzeFomod,
        args: [
          'C:\\Builds\\Skyrim',
          'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
          { operationId: 'op_test_downloads_fomod' }
        ]
      },
      {
        channel: FluxoraIpcChannels.downloadsAnalyzeFomodContentLayout,
        args: [
          {
            projectDirectory: 'C:\\Builds\\Skyrim',
            downloadPath: 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
            existingModMode: 0,
            selectedOptionIds: ['core']
          },
          { operationId: 'op_test_downloads_fomod_layout' }
        ]
      },
      {
        channel: FluxoraIpcChannels.downloadsInstall,
        args: [
          {
            projectDirectory: 'C:\\Builds\\Skyrim',
            downloadPath: 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
            modName: 'SkyUI',
            existingModMode: 0
          },
          { operationId: 'op_test_downloads_install' }
        ]
      },
      {
        channel: FluxoraIpcChannels.downloadsInstallFomod,
        args: [
          {
            projectDirectory: 'C:\\Builds\\Skyrim',
            downloadPath: 'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
            modName: 'SkyUI',
            existingModMode: 1,
            selectedOptionIds: ['core']
          },
          { operationId: 'op_test_downloads_install_fomod' }
        ]
      },
      {
        channel: FluxoraIpcChannels.archivesInstall,
        args: [
          {
            projectDirectory: 'C:\\Builds\\Skyrim',
            archivePath: 'C:\\Archives\\SkyUI.7z',
            modName: 'SkyUI',
            existingModMode: 0
          },
          { operationId: 'op_test_archives_install' }
        ]
      },
      {
        channel: FluxoraIpcChannels.archivesInstallFomod,
        args: [
          {
            projectDirectory: 'C:\\Builds\\Skyrim',
            archivePath: 'C:\\Archives\\SkyUI.7z',
            modName: 'SkyUI',
            existingModMode: 2,
            selectedOptionIds: ['core']
          },
          { operationId: 'op_test_archives_install_fomod' }
        ]
      },
      {
        channel: FluxoraIpcChannels.downloadsDelete,
        args: [
          'C:\\Builds\\Skyrim',
          'C:\\Builds\\Skyrim\\downloads\\SkyUI.7z',
          { operationId: 'op_test_downloads_delete' }
        ]
      },
      {
        channel: FluxoraIpcChannels.nxmRegisterProtocol,
        args: [{ operationId: 'op_test_nxm_register' }]
      },
      {
        channel: FluxoraIpcChannels.nxmCaptureLinks,
        args: [
          'C:\\Builds\\Skyrim',
          ['nxm://skyrimspecialedition/mods/3863/files/123'],
          { operationId: 'op_test_nxm_capture' }
        ]
      },
      {
        channel: FluxoraIpcChannels.nxmImportInboundDownloads,
        args: ['C:\\Builds\\Skyrim', { operationId: 'op_test_nxm_import_inbound' }]
      },
      {
        channel: FluxoraIpcChannels.nexusGetAuthStatus,
        args: [{ operationId: 'op_test_nexus_status' }]
      },
      {
        channel: FluxoraIpcChannels.nexusConnect,
        args: [{ operationId: 'op_test_nexus_connect' }]
      },
      {
        channel: FluxoraIpcChannels.nexusDisconnect,
        args: [{ operationId: 'op_test_nexus_disconnect' }]
      },
      {
        channel: FluxoraIpcChannels.bridgeGetLanguage,
        args: [{ operationId: 'op_test_settings_language_get' }]
      },
      {
        channel: FluxoraIpcChannels.bridgeSetLanguage,
        args: ['de-de', { operationId: 'op_test_settings_language_set' }]
      },
      {
        channel: FluxoraIpcChannels.settingsGetTheme,
        args: [{ operationId: 'op_test_settings_theme_get' }]
      },
      {
        channel: FluxoraIpcChannels.settingsSetTheme,
        args: ['light', { operationId: 'op_test_settings_theme_set' }]
      },
      {
        channel: FluxoraIpcChannels.transferAnalyzeMo2,
        args: [
          'C:\\MO2',
          'C:\\Fluxora\\Builds',
          'C:\\Builds\\Skyrim.json',
          { operationId: 'op_test_transfer_analyze' }
        ]
      },
      {
        channel: FluxoraIpcChannels.transferImportMo2,
        args: [
          {
            sourceDirectory: 'C:\\MO2',
            destinationRootDirectory: 'C:\\Fluxora\\Builds',
            existingConfigPath: 'C:\\Builds\\Skyrim.json',
            replaceExisting: true
          },
          { operationId: 'op_test_transfer_import' }
        ]
      },
      {
        channel: FluxoraIpcChannels.transferListDestinationDrives,
        args: [{ operationId: 'op_test_transfer_drives' }]
      },
      {
        channel: FluxoraIpcChannels.transferStartMo2InMain,
        args: [
          {
            request: {
              sourceDirectory: 'C:\\MO2',
              destinationRootDirectory: 'C:\\Fluxora\\Builds',
              existingConfigPath: 'C:\\Builds\\Skyrim.json',
              replaceExisting: true
            }
          }
        ]
      },
      {
        channel: FluxoraIpcChannels.transferOpenMo2InMain,
        args: []
      },
      {
        channel: FluxoraIpcChannels.buildPathsGet,
        args: ['C:\\Builds\\Skyrim.json', { operationId: 'op_test_build_paths_get' }]
      },
      {
        channel: FluxoraIpcChannels.buildPathsSave,
        args: [
          'C:\\Builds\\Skyrim.json',
          {
            gameDirectory: 'C:\\Games\\Skyrim',
            modsDirectory: 'C:\\Builds\\Skyrim\\mods',
            profilesDirectory: 'C:\\Builds\\Skyrim\\profiles',
            downloadsDirectory: 'C:\\Builds\\Skyrim\\downloads',
            overwriteDirectory: 'C:\\Builds\\Skyrim\\overwrite'
          },
          { operationId: 'op_test_build_paths_save' }
        ]
      },
      {
        channel: FluxoraIpcChannels.fluxPackExport,
        args: [
          {
            configPath: 'C:\\Builds\\Skyrim.json',
            outputPath: 'C:\\Packs\\Skyrim.fluxpack',
            includeGeneratedAssets: true
          },
          { operationId: 'op_test_fluxpack_export' }
        ]
      },
      {
        channel: FluxoraIpcChannels.fluxPackInspect,
        args: ['C:\\Packs\\Skyrim.fluxpack', { operationId: 'op_test_fluxpack_inspect' }]
      },
      {
        channel: FluxoraIpcChannels.fluxPackInstall,
        args: [
          {
            fluxPackPath: 'C:\\Packs\\Skyrim.fluxpack',
            installRootDirectory: 'C:\\Fluxora\\Builds'
          },
          { operationId: 'op_test_fluxpack_install' }
        ]
      },
      {
        channel: FluxoraIpcChannels.operationsCancel,
        args: ['op_test_transfer_import', { operationId: 'op_test_operations_cancel' }]
      },
      { channel: FluxoraIpcChannels.shellOpenPath, args: ['C:\\Fluxora'] },
      {
        channel: FluxoraIpcChannels.shellShowItemInFolder,
        args: ['C:\\Fluxora\\Downloads\\SkyUI.7z']
      },
      {
        channel: FluxoraIpcChannels.dialogPickArchive,
        args: ['C:\\Fluxora\\Downloads']
      },
      {
        channel: FluxoraIpcChannels.dialogPickBuildConfig,
        args: ['C:\\Users\\Test\\AppData\\Roaming\\Fluxora\\Builds']
      },
      {
        channel: FluxoraIpcChannels.dialogPickExecutable,
        args: ['Pick game', 'C:\\Games\\Skyrim\\SkyrimSE.exe']
      },
      {
        channel: FluxoraIpcChannels.dialogPickFluxPack,
        args: ['C:\\Packs']
      },
      {
        channel: FluxoraIpcChannels.dialogPickFolder,
        args: ['Pick builds', 'C:\\Users\\Test\\AppData\\Roaming\\Fluxora\\Projects']
      },
      {
        channel: FluxoraIpcChannels.dialogSaveFluxPack,
        args: ['C:\\Packs\\Skyrim.fluxpack', 'Save package']
      },
      { channel: FluxoraIpcChannels.bridgeGetStatus, args: [{ operationId: 'op_test_status' }] },
      { channel: FluxoraIpcChannels.bridgeGetLanguage, args: [{ operationId: 'op_test_language_get' }] },
      {
        channel: FluxoraIpcChannels.bridgeSetLanguage,
        args: ['ru-ru', { operationId: 'op_test_language_set' }]
      },
      { channel: FluxoraIpcChannels.bridgeShutdown, args: [{ operationId: 'op_test_shutdown' }] },
      { channel: FluxoraIpcChannels.templatesList, args: [{ operationId: 'op_test_templates' }] },
      {
        channel: FluxoraIpcChannels.templatesResolve,
        args: ['skyrim-special-edition', { operationId: 'op_test_template_resolve' }]
      },
      { channel: FluxoraIpcChannels.projectsList, args: [{ operationId: 'op_test_projects' }] },
      {
        channel: FluxoraIpcChannels.projectsOpenConfig,
        args: ['C:\\Builds\\Skyrim.json', { operationId: 'op_test_open' }]
      },
      {
        channel: FluxoraIpcChannels.projectsPreviewDirectory,
        args: [
          'Skyrim Build',
          'C:\\Builds',
          { operationId: 'op_test_preview' }
        ]
      },
      {
        channel: FluxoraIpcChannels.projectsCreate,
        args: [
          {
            projectName: 'Skyrim Build',
            templateId: 'skyrim-special-edition',
            gamePath: 'C:\\Games\\Skyrim\\SkyrimSE.exe',
            installRootDirectory: 'C:\\Builds'
          },
          { operationId: 'op_test_create' }
        ]
      },
      {
        channel: FluxoraIpcChannels.projectsRename,
        args: ['C:\\Builds\\Skyrim.json', 'Skyrim Modded', { operationId: 'op_test_rename' }]
      },
      {
        channel: FluxoraIpcChannels.projectsDelete,
        args: ['C:\\Builds\\Skyrim.json', { operationId: 'op_test_delete' }]
      },
      {
        channel: FluxoraIpcChannels.uiLog,
        args: [{ level: 'info', message: 'hello', operationId: 'op_test_ui' }]
      },
      { channel: FluxoraIpcChannels.windowMinimize, args: [] },
      { channel: FluxoraIpcChannels.windowOpenSettings, args: [] },
      { channel: FluxoraIpcChannels.windowToggleMaximize, args: [] },
      { channel: FluxoraIpcChannels.windowClose, args: [] }
    ]);
  });

  it('subscribes to operation progress events through the allowlisted channel', () => {
    const listeners = new Map<FluxoraIpcChannel, (...args: unknown[]) => void>();
    const api = createFluxoraApi({
      invoke: async () => ({}),
      on: (channel, listener) => {
        listeners.set(channel, listener);
      },
      removeListener: (channel, listener) => {
        if (listeners.get(channel) === listener) {
          listeners.delete(channel);
        }
      }
    });
    const received: unknown[] = [];

    const unsubscribe = api.operations.onProgress((progress) => received.push(progress));
    listeners.get(FluxoraIpcChannels.operationsProgress)?.({}, {
      operationId: 'op_transfer',
      phase: 'copying',
      overallPercent: 40
    });

    expect(received).toEqual([
      {
        operationId: 'op_transfer',
        phase: 'copying',
        overallPercent: 40
      }
    ]);

    unsubscribe();
    expect(listeners.has(FluxoraIpcChannels.operationsProgress)).toBe(false);
  });

  it('subscribes to MO2 transfer handoff events through the allowlisted channel', () => {
    const listeners = new Map<FluxoraIpcChannel, (...args: unknown[]) => void>();
    const api = createFluxoraApi({
      invoke: async () => ({}),
      on: (channel, listener) => {
        listeners.set(channel, listener);
      },
      removeListener: (channel, listener) => {
        if (listeners.get(channel) === listener) {
          listeners.delete(channel);
        }
      }
    });
    const received: unknown[] = [];

    const unsubscribe = api.transfer.onMo2Handoff((handoff) => received.push(handoff));
    listeners.get(FluxoraIpcChannels.transferMo2Handoff)?.({}, {
      request: {
        sourceDirectory: 'C:\\MO2',
        destinationRootDirectory: 'C:\\Fluxora\\Builds',
        replaceExisting: false
      }
    });

    expect(received).toEqual([
      {
        request: {
          sourceDirectory: 'C:\\MO2',
          destinationRootDirectory: 'C:\\Fluxora\\Builds',
          replaceExisting: false
        }
      }
    ]);

    unsubscribe();
    expect(listeners.has(FluxoraIpcChannels.transferMo2Handoff)).toBe(false);
  });

  it('subscribes to MO2 transfer open events through the allowlisted channel', () => {
    const listeners = new Map<FluxoraIpcChannel, (event: unknown, payload?: unknown) => void>();
    const api = createFluxoraApi({
      invoke: async () => ({}),
      on: (channel, listener) => {
        listeners.set(channel, listener);
      },
      removeListener: (channel) => {
        listeners.delete(channel);
      }
    });

    let opened = 0;
    const unsubscribe = api.transfer.onMo2Open(() => {
      opened += 1;
    });
    listeners.get(FluxoraIpcChannels.transferMo2Open)?.({});

    expect(opened).toBe(1);

    unsubscribe();
    expect(listeners.has(FluxoraIpcChannels.transferMo2Open)).toBe(false);
  });
});
