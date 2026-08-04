import { describe, expect, it } from 'vitest';

import {
  buildArchivePlacementRows,
  coerceFomodSelection,
  createPlacementOverrideForDrop,
  createPlacementOverrides,
  evaluateFomodWizard,
  findExistingInstalledModName,
  installCategoryLabel,
  installDestinationPreview,
  installSourceLabel,
  initialFomodSelection,
  sanitizeFomodManualDecisions,
  toggleFomodOption,
  updateFomodManualDecisions,
  validateInstallModName
} from '../src/renderer/install-workspace-state';
import type {
  FluxoraContentLayoutPreview,
  FluxoraFomodInstaller
} from '../src/shared/fluxora-api';

const preview: FluxoraContentLayoutPreview = {
  gameId: 'skyrimse',
  gameDisplayName: 'Skyrim Special Edition',
  rootFileWrapperDirectory: '',
  canInstall: false,
  summary: {
    supported: true,
    hasWarnings: true,
    hasBlockers: true,
    totalEntries: 2,
    plannedEntries: 1,
    gameDataEntries: 1,
    gameRootEntries: 0,
    pluginEntries: 1,
    archiveEntries: 0,
    scriptExtenderEntries: 0,
    unknownEntries: 1,
    unsafeEntries: 0
  },
  entries: [
    {
      sourcePath: 'Data/SkyUI.esp',
      target: 'data',
      contentArea: 'data',
      targetRelativePath: 'SkyUI.esp',
      classification: 'plugin',
      explanation: 'Plugin goes to Data.',
      manualOverrideAllowed: true,
      safeManualTargets: ['data', 'gameRoot'],
      included: true
    },
    {
      sourcePath: 'tools/helper.exe',
      target: 'blocked',
      contentArea: 'blocked',
      targetRelativePath: '',
      classification: 'toolExecutable',
      explanation: 'Unexpected executable.',
      manualOverrideAllowed: true,
      safeManualTargets: ['gameRoot'],
      included: true
    }
  ],
  validationFindings: [
    {
      severity: 'error',
      path: 'tools/helper.exe',
      classification: 'toolExecutable',
      message: 'Unexpected executable.',
      blocksInstall: true
    }
  ],
  explanationSummary: 'Layout needs review.',
  explanationDetails: []
};

const fomod: FluxoraFomodInstaller = {
  isFomod: true,
  moduleName: 'SkyUI',
  moduleVersion: '5.2',
  moduleId: 'skyui',
  moduleImagePath: '',
  memoryKey: 'skyui',
  hasPreviousSelection: true,
  previousSelectedOptionIds: ['mcm'],
  fileDependencies: [{ file: 'Data/SKSE/skse64_loader.exe', exists: true }],
  requiredFiles: [],
  conditionalFilePatterns: [],
  steps: [
    {
      id: 'main',
      name: 'Main',
      visible: null,
      groups: [
        {
          id: 'variant',
          name: 'Variant',
          type: 'SelectExactlyOne',
          options: [
            {
              id: 'mcm',
              name: 'MCM',
              description: 'MCM package',
              imagePath: '',
              type: 'Recommended',
              defaultType: 'Recommended',
              flags: [{ name: 'variant', value: 'mcm' }],
              typePatterns: []
            },
            {
              id: 'classic',
              name: 'Classic',
              description: 'Classic package',
              imagePath: '',
              type: 'Optional',
              defaultType: 'Optional',
              flags: [{ name: 'variant', value: 'classic' }],
              typePatterns: []
            }
          ]
        }
      ]
    },
    {
      id: 'skse',
      name: 'SKSE',
      visible: {
        kind: 'flag',
        operator: 'And',
        file: '',
        state: '',
        flag: 'variant',
        value: 'mcm',
        version: '',
        children: []
      },
      groups: [
        {
          id: 'skse-files',
          name: 'SKSE files',
          type: 'SelectAny',
          options: [
            {
              id: 'loader',
              name: 'SKSE loader',
              description: 'Required when SKSE is present',
              imagePath: '',
              type: 'Optional',
              defaultType: 'Optional',
              flags: [],
              typePatterns: [
                {
                  type: 'Required',
                  dependencies: {
                    kind: 'file',
                    operator: 'And',
                    file: 'Data/SKSE/skse64_loader.exe',
                    state: 'Active',
                    flag: '',
                    value: '',
                    version: '',
                    children: []
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};

describe('install workspace state', () => {
  it('validates mod folder names without claiming core ownership', () => {
    expect(validateInstallModName(' SkyUI ')).toBe('');
    expect(validateInstallModName('CON')).toContain('reserved');
    expect(validateInstallModName('bad/name')).toContain('characters');
    expect(validateInstallModName('CON', 'ru-RU')).toBe(
      'Это название зарезервировано в Windows. Выберите другое.'
    );
  });

  it('builds placement rows and serializes real drop overrides', () => {
    const rows = buildArchivePlacementRows(preview);
    const dataFolder = rows.find((row) => row.isDirectory && row.displayPath === 'Data');
    const blockedFile = preview.entries[1];

    expect(dataFolder?.canAcceptDrops).toBe(true);
    expect(createPlacementOverrideForDrop(blockedFile, dataFolder!)).toBeNull();

    const plugin = preview.entries[0];
    const override = createPlacementOverrideForDrop(plugin, dataFolder!);
    expect(override).toEqual({
      sourcePath: 'Data/SkyUI.esp',
      target: 'data',
      targetRelativePath: 'SkyUI.esp'
    });

    const rootRows = buildArchivePlacementRows(preview, {
      'tools/helper.exe': {
        target: 'gameRoot',
        targetRelativePath: 'helper.exe'
      }
    });
    expect(rootRows.some((row) => row.displayPath === 'helper.exe')).toBe(true);
    expect(
      createPlacementOverrides(preview, {
        'tools/helper.exe': {
          target: 'gameRoot',
          targetRelativePath: 'helper.exe'
        }
      })
    ).toEqual([
      {
        sourcePath: 'tools/helper.exe',
        target: 'gameRoot',
        targetRelativePath: 'helper.exe'
      }
    ]);
  });

  it('evaluates FOMOD defaults, dynamic required options and exclusive groups', () => {
    const initial = initialFomodSelection(fomod);
    expect(initial).toContain('mcm');

    const evaluation = evaluateFomodWizard(fomod, initial);
    expect(evaluation.visibleSteps).toHaveLength(2);
    expect(evaluation.selectedOptionIds).toEqual(['mcm', 'loader']);

    const classic = toggleFomodOption(fomod, initial, 'classic', true);
    expect(classic).toContain('classic');
    expect(classic).not.toContain('mcm');
    expect(evaluateFomodWizard(fomod, classic).visibleSteps).toHaveLength(1);

    expect(coerceFomodSelection(fomod, [])).toContain('mcm');
  });

  it('distinguishes inactive profile files from active dependencies', () => {
    const inactiveInstaller: FluxoraFomodInstaller = {
      ...fomod,
      fileDependencies: [
        {
          file: 'Data/SKSE/skse64_loader.exe',
          state: 'Inactive',
          sourceKind: 'mod',
          sourceName: 'Disabled SKSE',
          exists: true
        }
      ]
    };

    const inactive = evaluateFomodWizard(inactiveInstaller, initialFomodSelection(inactiveInstaller));
    expect(inactive.selectedOptionIds).toEqual(['mcm']);
    expect(inactive.visibleSteps[1].groups[0].options[0].effectiveType).toBe('Optional');

    const active = evaluateFomodWizard(
      {
        ...inactiveInstaller,
        fileDependencies: [{ ...inactiveInstaller.fileDependencies[0], state: 'Active' }]
      },
      initialFomodSelection(inactiveInstaller)
    );
    expect(active.selectedOptionIds).toEqual(['mcm', 'loader']);
  });

  it('restores a valid remembered FOMOD choice instead of replacing it with defaults', () => {
    const remembered = {
      ...fomod,
      previousSelectedOptionIds: ['classic']
    };

    expect(initialFomodSelection(remembered)).toEqual(['classic']);
    expect(evaluateFomodWizard(remembered, initialFomodSelection(remembered)).visibleSteps).toHaveLength(1);
  });

  it('uses the core Smart Select plan without guessing ambiguous exclusive groups', () => {
    const smartInstaller: FluxoraFomodInstaller = {
      ...fomod,
      autoSelection: {
        contextId: 'fomod-context-1',
        initialSelectedOptionIds: ['classic'],
        unresolvedGroups: [],
        decisions: [
          {
            optionId: 'mcm',
            action: 'deselect',
            confidence: 'strong',
            effectiveType: 'Recommended',
            reasonCodes: ['author.optional'],
            evidence: []
          },
          {
            optionId: 'classic',
            action: 'select',
            confidence: 'exact',
            effectiveType: 'Optional',
            reasonCodes: ['profile.exactRecommendation'],
            evidence: []
          }
        ],
        moduleDependencyResult: 'satisfied',
        installBlocked: false,
        cycleDetected: false,
        warnings: []
      }
    };

    expect(initialFomodSelection(smartInstaller)).toEqual(['classic']);

    const ambiguous: FluxoraFomodInstaller = {
      ...smartInstaller,
      autoSelection: {
        ...smartInstaller.autoSelection!,
        initialSelectedOptionIds: [],
        unresolvedGroups: [
          {
            stepId: 'main',
            groupId: 'variant',
            groupName: 'Variant',
            reasonCode: 'group.ambiguous',
            optionIds: ['mcm', 'classic']
          }
        ]
      }
    };
    expect(initialFomodSelection(ambiguous)).toEqual([]);
  });

  it('records manual pins for the affected exclusive group and drops stale option ids', () => {
    const selected = toggleFomodOption(fomod, ['mcm'], 'classic', true);
    const manual = updateFomodManualDecisions(fomod, [], selected, 'classic');

    expect(manual).toEqual([
      { optionId: 'mcm', selected: false },
      { optionId: 'classic', selected: true }
    ]);
    expect(
      sanitizeFomodManualDecisions(fomod, [
        ...manual,
        { optionId: 'removed-option', selected: true },
        { optionId: 'classic', selected: false }
      ])
    ).toEqual([
      { optionId: 'mcm', selected: false },
      { optionId: 'classic', selected: false }
    ]);
  });

  it('detects existing mods case-insensitively for replace merge UX', () => {
    expect(findExistingInstalledModName(['SkyUI', 'RaceMenu'], 'skyui')).toBe('SkyUI');
    expect(findExistingInstalledModName(['SkyUI'], 'SmoothCam')).toBeNull();
  });

  it('builds simple install identity labels without owning install rules', () => {
    expect(
      installSourceLabel({
        kind: 'download',
        sourcePath: 'D:\\Fluxora\\downloads\\SkyUI.7z',
        displayName: 'SkyUI',
        fileName: 'SkyUI.7z'
      })
    ).toBe('Download · SkyUI.7z');
    expect(installDestinationPreview('D:\\Fluxora\\Builds\\mods\\', ' SkyUI ')).toBe(
      'D:\\Fluxora\\Builds\\mods\\SkyUI'
    );
    expect(installCategoryLabel(preview, true)).toBe(
      'Skyrim Special Edition · FOMOD · blocked'
    );
  });
});
