import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';

import { normalizeAppLocale } from '../../../localization';
import {
  appLanguageReducer,
  initialAppLanguageState
} from '../../../localization/app-language-state';
import { LocalizationProvider, useLocalization } from '../../../localization/react';
import type {
  FluxoraExecutable,
  FluxoraExecutablesSavedEvent
} from '../../../shared/fluxora-api';
import { AppTitlebar } from '../../components/chrome/AppTitlebar';
import { Button, Skeleton } from '../../design-system';
import { usePointerReorderSession } from '../../hooks/usePointerReorderSession';
import { createRendererOperationId } from '../../services/renderer-operation-service';
import { ExecutableIdentity } from './ExecutableIdentity';
import {
  commitExecutableDraft,
  ExecutableDraftInspectionError
} from './executable-manager-save';
import {
  applyExecutableInspection,
  createExecutableDraft,
  createNewExecutableDraft,
  executableDraftIsDirty,
  moveExecutableDraft,
  moveExecutableDraftByOffset,
  persistedExecutablesFromDraft,
  setExecutableDraftArguments,
  setExecutableDraftName,
  setExecutableDraftPath,
  validateExecutableDraft,
  type ExecutableDraftEntry,
  type ExecutableDropPlacement
} from './executable-manager-state';
import { readExecutableSettingsBootstrap } from './executable-settings-bootstrap';
import { requestExecutableSettingsClose } from './executable-settings-close';

import './executable-settings-window.css';

interface DropTarget {
  id: string;
  placement: ExecutableDropPlacement;
}

interface DragPreview {
  sourceId: string;
  x: number;
  y: number;
}

interface PendingExternalChange {
  event: FluxoraExecutablesSavedEvent;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function ExecutableSettingsWorkspace({
  buildName,
  configPath,
  initialExecutables,
  initialSelectedId
}: {
  buildName: string;
  configPath: string;
  initialExecutables: FluxoraExecutable[];
  initialSelectedId: string | null;
}) {
  const { t } = useLocalization();
  const initialSelection = initialExecutables.some((entry) => entry.id === initialSelectedId)
    ? initialSelectedId
    : initialExecutables[0]?.id ?? null;
  const [saved, setSaved] = useState<FluxoraExecutable[]>(initialExecutables);
  const [draft, setDraft] = useState<ExecutableDraftEntry[]>(() =>
    createExecutableDraft(initialExecutables)
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection);
  const [loading, setLoading] = useState(initialExecutables.length === 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const [pendingExternal, setPendingExternal] = useState<PendingExternalChange | null>(null);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const dirtyRef = useRef(false);
  const saveOperationIdRef = useRef<string | null>(null);
  const inspectSequenceRef = useRef(new Map<string, number>());
  const draftSequenceRef = useRef(0);
  const selected = draft.find((entry) => entry.id === selectedId) ?? null;
  const dragPreviewEntry = dragPreview
    ? draft.find((entry) => entry.id === dragPreview.sourceId) ?? null
    : null;
  const dirty = executableDraftIsDirty(draft, saved);
  dirtyRef.current = dirty;

  const applyCanonical = useCallback((executables: FluxoraExecutable[]) => {
    setSaved(executables);
    setDraft(createExecutableDraft(executables));
    setSelectedId((current) =>
      executables.some((entry) => entry.id === current)
        ? current
        : executables[0]?.id ?? null
    );
    setPendingExternal(null);
    setError(null);
  }, []);

  useEffect(() => {
    let active = true;
    const operationId = createRendererOperationId('executables_manager_load');
    void window.fluxora.executables.list(configPath, { operationId }).then((executables) => {
      if (!active) return;
      if (dirtyRef.current) {
        setPendingExternal({
          event: { configPath, executables, operationId }
        });
      } else {
        applyCanonical(executables);
      }
    }).catch((loadError) => {
      if (active) setError(errorText(loadError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [applyCanonical, configPath]);

  useEffect(() => window.fluxora.executables.onSaved((event) => {
    if (event.configPath !== configPath) return;
    if (event.operationId === saveOperationIdRef.current) {
      applyCanonical(event.executables);
      return;
    }
    if (dirtyRef.current) {
      setPendingExternal({ event });
    } else {
      applyCanonical(event.executables);
    }
  }), [applyCanonical, configPath]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    void window.fluxora.windowControls.onCloseRequested(() => {
      if (dirtyRef.current) {
        setDiscardConfirmationOpen(true);
        return false;
      }
      return true;
    }).then((unlisten) => {
      dispose = unlisten;
    });
    return () => dispose?.();
  }, []);

  const closeWindow = useCallback(async () => {
    try {
      await requestExecutableSettingsClose({
        dirty: dirtyRef.current,
        forceClose: window.fluxora.windowControls.forceClose,
        openDiscardConfirmation: () => setDiscardConfirmationOpen(true)
      });
    } catch (closeError) {
      setError(errorText(closeError));
      window.requestAnimationFrame(() => errorRef.current?.focus());
    }
  }, []);

  const confirmDiscardAndClose = useCallback(async () => {
    setDiscardConfirmationOpen(false);
    try {
      await window.fluxora.windowControls.forceClose();
    } catch (closeError) {
      setError(errorText(closeError));
      window.requestAnimationFrame(() => errorRef.current?.focus());
    }
  }, []);

  const updateEntry = useCallback(
    (id: string, update: (entry: ExecutableDraftEntry) => ExecutableDraftEntry) => {
      setDraft((current) => current.map((entry) => entry.id === id ? update(entry) : entry));
      setError(null);
    },
    []
  );

  const inspectEntry = useCallback(async (
    id: string,
    executablePath: string
  ) => {
    const sequence = (inspectSequenceRef.current.get(id) ?? 0) + 1;
    inspectSequenceRef.current.set(id, sequence);
    setError(null);
    try {
      const inspection = await window.fluxora.executables.inspect(configPath, executablePath, {
        operationId: createRendererOperationId('executables_inspect')
      });
      if (inspectSequenceRef.current.get(id) !== sequence) return;
      updateEntry(id, (entry) => applyExecutableInspection(entry, inspection));
    } catch (inspectionError) {
      if (inspectSequenceRef.current.get(id) === sequence) {
        setError(errorText(inspectionError));
        window.requestAnimationFrame(() => errorRef.current?.focus());
      }
    }
  }, [configPath, updateEntry]);

  const addExecutable = useCallback(async () => {
    const picked = await window.fluxora.dialogs.pickExecutable(t('executables.dialog.add'));
    if (picked.canceled || !picked.path) return;
    draftSequenceRef.current += 1;
    const id = `custom-${Date.now().toString(36)}-${draftSequenceRef.current}`;
    const entry = setExecutableDraftPath(createNewExecutableDraft(id), picked.path);
    setDraft((current) => [...current, entry]);
    setSelectedId(id);
    void inspectEntry(id, picked.path);
  }, [inspectEntry, t]);

  const browseExecutable = useCallback(async () => {
    if (!selected) return;
    const picked = await window.fluxora.dialogs.pickExecutable(
      t('executables.dialog.selectExecutable'),
      selected.executablePath
    );
    if (picked.canceled || !picked.path) return;
    updateEntry(selected.id, (entry) => setExecutableDraftPath(entry, picked.path!));
    void inspectEntry(selected.id, picked.path);
  }, [inspectEntry, selected, t, updateEntry]);

  const confirmDelete = useCallback(() => {
    if (!deleteCandidateId) return;
    setDraft((current) => {
      const index = current.findIndex((entry) => entry.id === deleteCandidateId);
      const next = current.filter((entry) => entry.id !== deleteCandidateId);
      setSelectedId((selectedIdNow) => selectedIdNow === deleteCandidateId
        ? next[Math.min(index, next.length - 1)]?.id ?? null
        : selectedIdNow);
      return next;
    });
    setDeleteCandidateId(null);
  }, [deleteCandidateId]);

  const saveDraft = useCallback(async () => {
    const issues = validateExecutableDraft(draft);
    if (issues.length > 0) {
      const first = issues[0];
      setSelectedId(first.id);
      setError(first.field === 'displayName'
        ? t('executables.validation.nameRequired')
        : t('executables.validation.executableRequired'));
      window.requestAnimationFrame(() => {
        inputRefs.current.get(`${first.id}:${first.field}`)?.focus();
      });
      return;
    }

    const operationId = createRendererOperationId('executables_save');
    saveOperationIdRef.current = operationId;
    setSaving(true);
    setError(null);
    try {
      await commitExecutableDraft({
        configPath,
        executables: persistedExecutablesFromDraft(draft),
        operationId
      }, {
        inspect: window.fluxora.executables.inspect,
        save: window.fluxora.executables.save,
        acceptCanonical: applyCanonical,
        close: async () => {
          await window.fluxora.windowControls.forceClose();
        }
      });
    } catch (saveError) {
      if (saveError instanceof ExecutableDraftInspectionError) {
        setSelectedId(saveError.executableId);
        setError(errorText(saveError));
        window.requestAnimationFrame(() => {
          inputRefs.current.get(`${saveError.executableId}:executablePath`)?.focus();
        });
      } else {
        setError(errorText(saveError));
        window.requestAnimationFrame(() => errorRef.current?.focus());
      }
    } finally {
      setSaving(false);
      saveOperationIdRef.current = null;
    }
  }, [applyCanonical, configPath, draft, t]);

  const focusRow = useCallback((id: string) => {
    window.requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  }, []);

  const keyboardReorder = useCallback((id: string, offset: -1 | 1) => {
    setDraft((current) => {
      const next = moveExecutableDraftByOffset(current, id, offset);
      const position = next.findIndex((entry) => entry.id === id) + 1;
      if (next !== current) {
        setAnnouncement(t('executables.reorder.announcement', {
          name: next[position - 1]?.displayName || t('executable.fallback'),
          position,
          total: next.length
        }));
        focusRow(id);
      }
      return next;
    });
  }, [focusRow, t]);

  const pointerReorder = usePointerReorderSession<string, DropTarget>({
    threshold: 5,
    rowSelector: '[data-executable-id]',
    scrollContainerRef: listRef,
    edgeScrollDistance: 32,
    edgeScrollStep: 48,
    resolveTarget: (element, pointer) => {
      const id = element?.dataset.executableId;
      if (!element || !id) return null;
      const bounds = element.getBoundingClientRect();
      return {
        id,
        placement: pointer.y < bounds.top + bounds.height / 2 ? 'before' : 'after'
      };
    },
    onDragStart: ({ pointer, sourceId }) => {
      setDragSourceId(sourceId);
      setDragPreview({ sourceId, x: pointer.x, y: pointer.y });
    },
    onDragMove: ({ pointer, sourceId, target }) => {
      setDragPreview({ sourceId, x: pointer.x, y: pointer.y });
      setDropTarget(target);
    },
    onCancel: () => {
      setDragSourceId(null);
      setDragPreview(null);
      setDropTarget(null);
    },
    onDrop: ({ sourceId, target }) => {
      setDragSourceId(null);
      setDragPreview(null);
      setDropTarget(null);
      if (!target) return;
      setDraft((current) => {
        const next = moveExecutableDraft(current, sourceId, target.id, target.placement);
        const position = next.findIndex((entry) => entry.id === sourceId) + 1;
        if (next !== current) {
          setAnnouncement(t('executables.reorder.announcement', {
            name: next[position - 1]?.displayName || t('executable.fallback'),
            position,
            total: next.length
          }));
          focusRow(sourceId);
        }
        return next;
      });
    }
  });

  const handleRowKeyDown = (
    entry: ExecutableDraftEntry,
    event: ReactKeyboardEvent<HTMLDivElement>
  ) => {
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      keyboardReorder(entry.id, -1);
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      keyboardReorder(entry.id, 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const index = draft.findIndex((candidate) => candidate.id === entry.id);
      const next = draft[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (next) {
        setSelectedId(next.id);
        focusRow(next.id);
      }
    }
  };

  return (
    <>
      <AppTitlebar
        mode="settings"
        onClose={() => void closeWindow()}
        onMinimize={() => window.fluxora.windowControls.minimize()}
        onToggleMaximize={() => window.fluxora.windowControls.toggleMaximize()}
        showShortcuts={false}
        title={t('executables.window.title')}
      />
      <section className="executable-settings" aria-label={t('executables.window.aria')}>
      <header className="executable-settings__heading">
        <div>
          <h1>{t('executables.window.title')}</h1>
          <p>{buildName}</p>
        </div>
      </header>

      {pendingExternal ? (
        <div className="executable-settings__conflict" role="status">
          <span>{t('executables.conflict.message')}</span>
          <div>
            <button type="button" onClick={() => applyCanonical(pendingExternal.event.executables)}>
              {t('executables.conflict.reload')}
            </button>
            <button type="button" onClick={() => setPendingExternal(null)}>
              {t('executables.conflict.keepDraft')}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="executable-settings__error" ref={errorRef} role="alert" tabIndex={-1}>
          {error}
        </div>
      ) : null}

      <div className="executable-settings__body">
        <section className="executable-settings__list-section" aria-label={t('executables.list.aria')}>
          {loading && draft.length === 0 ? (
            <div
              aria-busy="true"
              aria-label={t('executables.loading')}
              className="executable-settings__skeleton"
            >
              <Skeleton /><Skeleton /><Skeleton />
            </div>
          ) : draft.length === 0 ? (
            <div className="executable-settings__empty">
              <span>{t('executables.empty')}</span>
              <button type="button" onClick={() => void addExecutable()}>
                {t('executables.add')}
              </button>
            </div>
          ) : (
            <div
              aria-label={t('executables.list.aria')}
              className="executable-settings__list"
              ref={listRef}
              role="listbox"
            >
              {draft.map((entry) => {
                const isSelected = entry.id === selectedId;
                const targetPlacement = dropTarget?.id === entry.id
                  ? dropTarget.placement
                  : undefined;
                return (
                  <div
                    aria-selected={isSelected}
                    className="executable-settings__row"
                    data-drag-source={dragSourceId === entry.id}
                    data-drop-placement={targetPlacement}
                    data-executable-id={entry.id}
                    key={entry.id}
                    onClick={() => setSelectedId(entry.id)}
                    onFocus={() => setSelectedId(entry.id)}
                    onKeyDown={(event) => handleRowKeyDown(entry, event)}
                    onPointerCancel={pointerReorder.cancel}
                    onPointerDown={(event) => pointerReorder.begin(event, {
                      sourceId: entry.id,
                      payload: entry.id
                    })}
                    onPointerMove={pointerReorder.move}
                    onPointerUp={pointerReorder.finish}
                    ref={(element) => {
                      if (element) rowRefs.current.set(entry.id, element);
                      else rowRefs.current.delete(entry.id);
                    }}
                    role="option"
                    tabIndex={isSelected ? 0 : -1}
                    title={entry.executablePath}
                  >
                    <ExecutableIdentity
                      displayName={entry.displayName || t('executable.fallback')}
                      iconPath={entry.iconPath}
                      secondaryText={entry.executablePath}
                      size={24}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="executable-settings__editor" aria-label={t('executables.editor.aria')}>
          {selected ? (
            <div className="executable-settings__form">
              <label>
                <span>{t('executables.field.name')}</span>
                <input
                  aria-label={t('executables.field.name')}
                  aria-invalid={!selected.displayName.trim()}
                  onChange={(event) => updateEntry(selected.id, (entry) =>
                    setExecutableDraftName(entry, event.target.value)
                  )}
                  ref={(element) => {
                    const key = `${selected.id}:displayName`;
                    if (element) inputRefs.current.set(key, element);
                    else inputRefs.current.delete(key);
                  }}
                  value={selected.displayName}
                />
              </label>

              <label>
                <span>{t('executables.field.executable')}</span>
                <span className="executable-settings__field-action">
                  <input
                    aria-label={t('executables.field.executable')}
                    aria-invalid={!/\.exe$/iu.test(selected.executablePath.trim())}
                    onChange={(event) => {
                      const path = event.target.value;
                      updateEntry(selected.id, (entry) => setExecutableDraftPath(entry, path));
                    }}
                    onBlur={() => {
                      if (selected.executablePath.trim()) {
                        void inspectEntry(selected.id, selected.executablePath);
                      }
                    }}
                    ref={(element) => {
                      const key = `${selected.id}:executablePath`;
                      if (element) inputRefs.current.set(key, element);
                      else inputRefs.current.delete(key);
                    }}
                    value={selected.executablePath}
                  />
                  <Button onClick={() => void browseExecutable()} size="sm" variant="secondary">
                    {t('executables.browse')}
                  </Button>
                </span>
              </label>

              <label>
                <span>{t('executables.field.arguments')}</span>
                <input
                  aria-label={t('executables.field.arguments')}
                  onChange={(event) => updateEntry(selected.id, (entry) =>
                    setExecutableDraftArguments(entry, event.target.value)
                  )}
                  value={selected.arguments}
                />
              </label>

            </div>
          ) : (
            <p className="executable-settings__editor-empty">{t('executables.editor.empty')}</p>
          )}
        </section>
      </div>

      {dragPreview && dragPreviewEntry ? (
        <div
          aria-hidden="true"
          className="executable-settings__drag-preview"
          style={{ left: dragPreview.x + 12, top: dragPreview.y + 12 }}
        >
          <ExecutableIdentity
            displayName={dragPreviewEntry.displayName || t('executable.fallback')}
            iconPath={dragPreviewEntry.iconPath}
            secondaryText={dragPreviewEntry.executablePath}
            size={24}
          />
        </div>
      ) : null}

      <footer className="executable-settings__footer">
        <div>
          <Button onClick={() => void addExecutable()} size="sm" variant="secondary">
            {t('executables.add')}
          </Button>
          <Button
            disabled={!selected}
            onClick={() => selected && setDeleteCandidateId(selected.id)}
            size="sm"
            variant="secondary"
          >
            {t('executables.delete')}
          </Button>
        </div>
        <div>
          <Button disabled={saving} onClick={() => void closeWindow()} size="sm" variant="secondary">
            {t('executables.cancel')}
          </Button>
          <Button disabled={!dirty || saving} onClick={() => void saveDraft()} size="sm">
            {saving ? t('executables.saving') : t('executables.save')}
          </Button>
        </div>
      </footer>

      <div className="sr-only" aria-live="polite">{announcement}</div>

      {deleteCandidateId ? (
        <div className="executable-settings__dialog-layer">
          <section aria-labelledby="executable-delete-title" aria-modal="true" role="alertdialog">
            <h2 id="executable-delete-title">{t('executables.deleteConfirm.title')}</h2>
            <p>{t('executables.deleteConfirm.description')}</p>
            <div>
              <Button onClick={() => setDeleteCandidateId(null)} size="sm" variant="secondary">
                {t('executables.cancel')}
              </Button>
              <Button onClick={confirmDelete} size="sm" variant="secondary">
                {t('executables.delete')}
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {discardConfirmationOpen ? (
        <div className="executable-settings__dialog-layer">
          <section aria-labelledby="executable-discard-title" aria-modal="true" role="alertdialog">
            <h2 id="executable-discard-title">{t('executables.discard.title')}</h2>
            <p>{t('executables.discard.description')}</p>
            <div>
              <Button onClick={() => setDiscardConfirmationOpen(false)} size="sm" variant="secondary">
                {t('executables.discard.keepEditing')}
              </Button>
              <Button onClick={() => void confirmDiscardAndClose()} size="sm" variant="secondary">
                {t('executables.discard.confirm')}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
      </section>
    </>
  );
}

export function ExecutableSettingsWindow() {
  const [appLanguage, dispatchAppLanguage] = useReducer(
    appLanguageReducer,
    initialAppLanguageState
  );
  const parameters = useMemo(() => new URLSearchParams(window.location.search), []);
  const configPath = parameters.get('project')?.trim() ?? '';
  const queryBuildName = parameters.get('name')?.trim() ?? '';
  const bootstrap = useMemo(() => readExecutableSettingsBootstrap(configPath), [configPath]);
  const buildName = bootstrap?.buildName || queryBuildName;

  useEffect(() => {
    let active = true;
    const unsubscribeLanguage = window.fluxora.settings.onLanguageChanged((result) => {
      if (active) dispatchAppLanguage({ type: 'language-confirmed', language: result.language });
    });
    void window.fluxora.settings.getTheme().then((result) => {
      if (active) document.documentElement.dataset.theme = result.theme;
    }).catch(() => undefined);
    void window.fluxora.app.getInfo().then((result) => {
      if (active) document.documentElement.dataset.platform = result.platform;
    }).catch(() => undefined);
    void window.fluxora.settings.getLanguage().then((result) => {
      if (active) dispatchAppLanguage({ type: 'native-loaded', language: result.language });
    }).catch(() => {
      if (active) dispatchAppLanguage({ type: 'native-load-failed' });
    });
    return () => {
      active = false;
      unsubscribeLanguage();
    };
  }, []);

  useLayoutEffect(() => {
    if (appLanguage.ready) {
      document.documentElement.lang = normalizeAppLocale(appLanguage.language);
    }
  }, [appLanguage.language, appLanguage.ready]);

  if (!appLanguage.ready) {
    return <main className="desktop-shell" aria-busy="true" />;
  }

  return (
    <LocalizationProvider language={appLanguage.language}>
      <main className="desktop-shell desktop-shell--settings-window desktop-shell--executable-settings">
        <ExecutableSettingsWorkspace
          buildName={buildName}
          configPath={configPath}
          initialExecutables={bootstrap?.executables ?? []}
          initialSelectedId={bootstrap?.selectedExecutableId ?? null}
        />
      </main>
    </LocalizationProvider>
  );
}
