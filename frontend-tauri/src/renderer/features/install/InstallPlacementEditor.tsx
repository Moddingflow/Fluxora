import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Move,
  Redo2,
  RotateCcw,
  Undo2
} from '../../design-system/icons/lucide-compat';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { createPortal } from 'react-dom';

import type {
  FluxoraContentLayoutPreview,
  FluxoraPlacementEditsV2
} from '../../../shared/fluxora-api';
import { createVirtualWindow } from '../../ui-performance';
import {
  buildInstallPlacementRows,
  advancePlacementHistory,
  createPlacementDirectory,
  deleteEmptyPlacementDirectory,
  emptyPlacementEdits,
  emptyPlacementHistory,
  movePlacementSelection,
  redoPlacementHistory,
  renamePlacementDirectory,
  setPlacementSelectionIncluded,
  undoPlacementHistory,
  type InstallPlacementRow,
  type PlacementEditResult
} from './install-placement-editor-state';
import {
  installPlacementContextMenuPositionFromAnchor,
  installPlacementContextMenuPositionFromPoint,
  type InstallPlacementContextMenuPosition
} from './install-placement-context-menu';

interface InstallPlacementEditorProps {
  preview: FluxoraContentLayoutPreview;
  edits: FluxoraPlacementEditsV2;
  language: string;
  validationPending: boolean;
  disabled?: boolean;
  onEditsChange: (edits: FluxoraPlacementEditsV2) => void;
}

interface PlacementCopy {
  title: string;
  data: string;
  gameRoot: string;
  attention: string;
  undo: string;
  redo: string;
  newFolder: string;
  reset: string;
  moveTo: string;
  rename: string;
  delete: string;
  cancel: string;
  validating: string;
  treeLabel: string;
  includeItem: (name: string) => string;
  selectionCount: (count: number) => string;
  problemCount: (count: number) => string;
  reason: Record<string, string>;
}

const copies: Record<'ru' | 'en' | 'de', PlacementCopy> = {
  ru: {
    title: 'Структура архива', data: 'Data', gameRoot: 'Корень игры', attention: 'Требует внимания',
    undo: 'Отменить', redo: 'Повторить', newFolder: 'Новая папка', reset: 'Сбросить',
    moveTo: 'Переместить в…', rename: 'Переименовать', delete: 'Удалить', cancel: 'Отмена',
    validating: 'Проверяем структуру…', treeLabel: 'Назначение файлов архива',
    selectionCount: (count) => `Выбрано: ${count}`,
    problemCount: (count) => `Проблем: ${count}`,
    reason: {
      'drop.target.invalid': 'Сюда нельзя перемещать файлы.',
      'drop.selection.invalid': 'Системные разделы и проблемные элементы нельзя перемещать.',
      'drop.self': 'Папку нельзя поместить внутрь самой себя.',
      'drop.same-parent': 'Элемент уже находится в этой папке.',
      'drop.group.not-allowed': 'Хотя бы один элемент группы нельзя поместить в выбранный раздел.',
      'drop.source.missing': 'Исходный элемент больше не найден.',
      'drop.collision': 'В целевой папке уже есть элемент с таким именем.',
      'drop.path.invalid': 'Путь содержит недопустимое для Windows имя.',
      'folder.name.empty': 'Введите имя папки.',
      'folder.name.invalid': 'Имя содержит недопустимые символы.',
      'folder.name.reserved': 'Это имя зарезервировано Windows.',
      'folder.delete.not-empty': 'Удалить можно только пустую созданную папку.',
      'folder.parent.invalid': 'Выберите доступную папку назначения.',
      'folder.rename.invalid': 'Эту папку нельзя переименовать.'
    },
    includeItem: (name) => `Устанавливать ${name}`
  },
  en: {
    title: 'Archive structure', data: 'Data', gameRoot: 'Game root', attention: 'Needs attention',
    undo: 'Undo', redo: 'Redo', newFolder: 'New folder', reset: 'Reset', moveTo: 'Move to…',
    rename: 'Rename', delete: 'Delete', cancel: 'Cancel', validating: 'Validating structure…',
    treeLabel: 'Archive file placement', selectionCount: (count) => `Selected: ${count}`,
    problemCount: (count) => `Problems: ${count}`,
    reason: {
      'drop.target.invalid': 'Items cannot be moved here.',
      'drop.selection.invalid': 'System roots and blocked items cannot be moved.',
      'drop.self': 'A folder cannot be moved into itself.',
      'drop.same-parent': 'The item is already in this folder.',
      'drop.group.not-allowed': 'At least one selected item is not allowed in this target.',
      'drop.source.missing': 'The source item is no longer available.',
      'drop.collision': 'An item with the same name already exists at the target.',
      'drop.path.invalid': 'The path contains a name that Windows does not allow.',
      'folder.name.empty': 'Enter a folder name.',
      'folder.name.invalid': 'The folder name contains invalid characters.',
      'folder.name.reserved': 'This name is reserved by Windows.',
      'folder.delete.not-empty': 'Only an empty folder created here can be deleted.',
      'folder.parent.invalid': 'Select an available destination folder.',
      'folder.rename.invalid': 'This folder cannot be renamed.'
    },
    includeItem: (name) => `Install ${name}`
  },
  de: {
    title: 'Archivstruktur', data: 'Data', gameRoot: 'Spielverzeichnis', attention: 'Erfordert Aufmerksamkeit',
    undo: 'Rückgängig', redo: 'Wiederholen', newFolder: 'Neuer Ordner', reset: 'Zurücksetzen',
    moveTo: 'Verschieben nach…', rename: 'Umbenennen', delete: 'Löschen', cancel: 'Abbrechen',
    validating: 'Struktur wird geprüft…', treeLabel: 'Archivdateien zuordnen',
    selectionCount: (count) => `Ausgewählt: ${count}`,
    problemCount: (count) => `Probleme: ${count}`,
    reason: {
      'drop.target.invalid': 'Elemente können hier nicht abgelegt werden.',
      'drop.selection.invalid': 'Systembereiche und blockierte Elemente können nicht verschoben werden.',
      'drop.self': 'Ein Ordner kann nicht in sich selbst verschoben werden.',
      'drop.same-parent': 'Das Element befindet sich bereits in diesem Ordner.',
      'drop.group.not-allowed': 'Mindestens ein ausgewähltes Element ist für dieses Ziel nicht zulässig.',
      'drop.source.missing': 'Das Quellelement ist nicht mehr verfügbar.',
      'drop.collision': 'Am Ziel ist bereits ein gleichnamiges Element vorhanden.',
      'drop.path.invalid': 'Der Pfad enthält einen unter Windows unzulässigen Namen.',
      'folder.name.empty': 'Ordnernamen eingeben.',
      'folder.name.invalid': 'Der Ordnername enthält unzulässige Zeichen.',
      'folder.name.reserved': 'Dieser Name ist unter Windows reserviert.',
      'folder.delete.not-empty': 'Nur ein hier erstellter leerer Ordner kann gelöscht werden.',
      'folder.parent.invalid': 'Einen verfügbaren Zielordner auswählen.',
      'folder.rename.invalid': 'Dieser Ordner kann nicht umbenannt werden.'
    },
    includeItem: (name) => `${name} installieren`
  }
};

const copyFor = (language: string): PlacementCopy =>
  language.toLocaleLowerCase().startsWith('de')
    ? copies.de
    : language.toLocaleLowerCase().startsWith('en')
      ? copies.en
      : copies.ru;

const rowHeight = 34;
const visibleRows = 15;
const overscanRows = 8;
const dragThreshold = 5;

interface PointerSession {
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  selectedKeys: Set<string>;
}

interface InclusionCheckboxProps {
  row: InstallPlacementRow;
  label: string;
  disabled: boolean;
  onChange: (included: boolean) => void;
}

function InclusionCheckbox({ row, label, disabled, onChange }: InclusionCheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = row.partiallyIncluded;
  }, [row.partiallyIncluded]);

  return (
    <label
      className="mod-enable-checkbox install-placement-row__checkbox"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="flx-checkbox__native"
        type="checkbox"
        tabIndex={-1}
        checked={row.included}
        aria-checked={row.partiallyIncluded ? 'mixed' : row.included}
        aria-label={label}
        disabled={disabled || row.sourcePaths.length === 0}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span aria-hidden="true" className="flx-checkbox__box" />
    </label>
  );
}

export function InstallPlacementEditor({
  preview,
  edits,
  language,
  validationPending,
  disabled = false,
  onEditsChange
}: InstallPlacementEditorProps) {
  const copy = copyFor(language);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState('root:data');
  const [scrollTop, setScrollTop] = useState(0);
  const [history, setHistory] = useState(emptyPlacementHistory);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropAllowed, setDropAllowed] = useState<boolean | null>(null);
  const [draggedKeys, setDraggedKeys] = useState<Set<string>>(() => new Set());
  const [dropReason, setDropReason] = useState('');
  const [rowContextMenu, setRowContextMenu] = useState<
    (InstallPlacementContextMenuPosition & { key: string }) | null
  >(null);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingError, setEditingError] = useState('');
  const treeRef = useRef<HTMLDivElement>(null);
  const rowElementsRef = useRef(new Map<string, HTMLDivElement>());
  const focusRequestedRef = useRef<string | null>(null);
  const pointerSession = useRef<PointerSession | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const dropResultRef = useRef<PlacementEditResult | null>(null);

  const rows = useMemo(
    () => buildInstallPlacementRows(preview, edits, collapsed),
    [collapsed, edits, preview]
  );
  const rowByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const contextMenuRow = rowContextMenu ? rowByKey.get(rowContextMenu.key) ?? null : null;
  const virtualWindow = createVirtualWindow(rows, scrollTop, {
    rowHeight,
    visibleRows,
    overscanRows
  });

  const localizedName = (row: InstallPlacementRow): string => {
    if (row.key === 'root:data') return copy.data;
    if (row.key === 'root:gameRoot') return row.name;
    if (row.key === 'root:attention') return copy.attention;
    return row.name;
  };

  const contextMenuItemCount = (row: InstallPlacementRow): number =>
    row.explicitDirectory ? 3 : 2;

  const contextMenuViewport = () => ({
    height: window.innerHeight,
    width: window.innerWidth
  });

  const openRowContextMenuAtPoint = (
    row: InstallPlacementRow,
    left: number,
    top: number
  ): void => {
    setRowContextMenu({
      key: row.key,
      ...installPlacementContextMenuPositionFromPoint(
        left,
        top,
        contextMenuItemCount(row),
        contextMenuViewport()
      )
    });
  };

  const openRowContextMenuFromAnchor = (
    row: InstallPlacementRow,
    anchor: DOMRect
  ): void => {
    setRowContextMenu({
      key: row.key,
      ...installPlacementContextMenuPositionFromAnchor(
        anchor,
        contextMenuItemCount(row),
        contextMenuViewport()
      )
    });
  };

  const focusRow = (key: string): void => {
    const index = rows.findIndex((row) => row.key === key);
    if (index < 0) return;
    focusRequestedRef.current = key;
    setFocusedKey(key);
    const tree = treeRef.current;
    if (tree) {
      const rowTop = index * rowHeight;
      const rowBottom = rowTop + rowHeight;
      if (rowTop < tree.scrollTop) tree.scrollTop = rowTop;
      else if (rowBottom > tree.scrollTop + tree.clientHeight) {
        tree.scrollTop = Math.max(0, rowBottom - tree.clientHeight);
      }
      setScrollTop(tree.scrollTop);
    }
  };

  useEffect(() => {
    const requested = focusRequestedRef.current;
    if (!requested || editingKey) return;
    const element = rowElementsRef.current.get(requested);
    if (element) {
      focusRequestedRef.current = null;
      element.focus({ preventScroll: true });
    }
  }, [editingKey, scrollTop, virtualWindow.items]);

  useEffect(() => {
    if (!rowContextMenu) return;

    const closeMenu = () => setRowContextMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          '[data-install-placement-context-menu-surface="true"], [data-install-placement-context-menu-trigger="true"]'
        )
      ) {
        return;
      }

      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [rowContextMenu]);

  const commit = (next: FluxoraPlacementEditsV2): void => {
    setHistory((current) => advancePlacementHistory(current, edits));
    setDropReason('');
    onEditsChange(next);
  };

  const applyResult = (result: PlacementEditResult): void => {
    if (!result.accepted) {
      setDropReason(copy.reason[result.reason] ?? result.reason);
      return;
    }
    commit(result.edits);
    const nextSelection = result.selectionKeys ?? (result.focusKey ? [result.focusKey] : null);
    if (nextSelection) {
      setSelected(new Set(nextSelection));
      const nextFocusKey = result.focusKey ?? nextSelection[0] ?? null;
      setSelectionAnchor(nextFocusKey);
      if (nextFocusKey) {
        focusRequestedRef.current = nextFocusKey;
        setFocusedKey(nextFocusKey);
      }
    }
  };

  const undo = (): void => {
    if (disabled) return;
    const result = undoPlacementHistory(history, edits);
    if (!result.edits) return;
    setHistory(result.history);
    onEditsChange(result.edits);
  };

  const redo = (): void => {
    if (disabled) return;
    const result = redoPlacementHistory(history, edits);
    if (!result.edits) return;
    setHistory(result.history);
    onEditsChange(result.edits);
  };

  const selectionForPointer = (row: InstallPlacementRow, event: ReactPointerEvent): Set<string> => {
    if (event.shiftKey && selectionAnchor) {
      const anchorIndex = rows.findIndex((candidate) => candidate.key === selectionAnchor);
      const rowIndex = rows.findIndex((candidate) => candidate.key === row.key);
      if (anchorIndex >= 0 && rowIndex >= 0) {
        return new Set(rows.slice(Math.min(anchorIndex, rowIndex), Math.max(anchorIndex, rowIndex) + 1)
          .filter((candidate) => !candidate.system)
          .map((candidate) => candidate.key));
      }
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected);
      if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
      return next;
    }
    return selected.has(row.key) ? new Set(selected) : new Set([row.key]);
  };

  const beginPointer = (row: InstallPlacementRow, event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || event.button !== 0 || row.blocked || editingKey) return;
    const nextSelection = selectionForPointer(row, event);
    setSelected(nextSelection);
    setSelectionAnchor(row.key);
    if (row.system) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerSession.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      selectedKeys: nextSelection
    };
  };

  const updatePointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = pointerSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!session.active && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= dragThreshold) {
      session.active = true;
      setDraggedKeys(new Set(session.selectedKeys));
    }
    if (!session.active) return;
    event.preventDefault();
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-placement-key]');
    const key = element?.dataset.placementKey ?? null;
    const candidate = key ? rowByKey.get(key) : undefined;
    const nextDropTarget = candidate && !candidate.blocked && (candidate.kind === 'directory' || candidate.kind === 'system-root')
      ? candidate.key
      : null;
    if (nextDropTarget !== dropTargetRef.current || dropAllowed === null) {
      const nextDropResult = nextDropTarget
        ? movePlacementSelection(preview, edits, session.selectedKeys, nextDropTarget)
        : null;
      dropTargetRef.current = nextDropTarget;
      dropResultRef.current = nextDropResult;
      setDropTarget(nextDropTarget);
      setDropAllowed(nextDropResult?.accepted ?? false);
    }
    const tree = treeRef.current;
    if (tree) {
      const bounds = tree.getBoundingClientRect();
      if (event.clientY < bounds.top + 28) tree.scrollBy({ top: -rowHeight, behavior: 'auto' });
      if (event.clientY > bounds.bottom - 28) tree.scrollBy({ top: rowHeight, behavior: 'auto' });
    }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = pointerSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerSession.current = null;
    const result = dropResultRef.current;
    dropTargetRef.current = null;
    dropResultRef.current = null;
    setDropTarget(null);
    setDropAllowed(null);
    setDraggedKeys(new Set());
    if (session.active && result) applyResult(result);
  };

  const cancelPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = pointerSession.current;
    if (session?.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerSession.current = null;
    dropTargetRef.current = null;
    dropResultRef.current = null;
    setDropTarget(null);
    setDropAllowed(null);
    setDraggedKeys(new Set());
  };

  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && pointerSession.current) {
        pointerSession.current = null;
        dropTargetRef.current = null;
        dropResultRef.current = null;
        setDropTarget(null);
        setDropAllowed(null);
        setDraggedKeys(new Set());
        setDropReason('');
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  const toggleCollapsed = (key: string, force?: boolean): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      const shouldCollapse = force ?? !next.has(key);
      if (shouldCollapse) next.add(key); else next.delete(key);
      return next;
    });
  };

  const selectRow = (row: InstallPlacementRow, shiftKey: boolean, toggle: boolean): void => {
    if (row.system && row.kind !== 'system-root') return;
    if (shiftKey && selectionAnchor) {
      const anchor = rows.findIndex((candidate) => candidate.key === selectionAnchor);
      const current = rows.findIndex((candidate) => candidate.key === row.key);
      if (anchor >= 0 && current >= 0) {
        setSelected(new Set(rows.slice(Math.min(anchor, current), Math.max(anchor, current) + 1)
          .filter((candidate) => !candidate.system)
          .map((candidate) => candidate.key)));
        return;
      }
    }
    if (toggle) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
        return next;
      });
    } else {
      setSelected(new Set([row.key]));
    }
    setSelectionAnchor(row.key);
  };

  const startRename = (row: InstallPlacementRow): void => {
    if (row.kind !== 'directory' || row.system) return;
    setEditingKey(row.key);
    setEditingValue(row.name);
    setEditingError('');
    setRowContextMenu(null);
  };

  const saveRename = (): void => {
    if (!editingKey) return;
    const result = renamePlacementDirectory(preview, edits, editingKey, editingValue);
    if (!result.accepted) {
      setEditingError(copy.reason[result.reason] ?? result.reason);
      return;
    }
    setEditingKey(null);
    setEditingError('');
    applyResult(result);
  };

  const createFolder = (parentKey?: string): void => {
    setRowContextMenu(null);
    const parent = parentKey
      ? rowByKey.get(parentKey)
      : [...selected].map((key) => rowByKey.get(key)).find((row) => row && (row.kind === 'directory' || row.kind === 'system-root'));
    const destinationKey = parent && !parent.blocked ? parent.key : 'root:data';
    let index = 1;
    let result = createPlacementDirectory(preview, edits, destinationKey, copy.newFolder);
    while (!result.accepted && result.reason === 'drop.collision' && index < 100) {
      index += 1;
      result = createPlacementDirectory(preview, edits, destinationKey, `${copy.newFolder} ${index}`);
    }
    applyResult(result);
    if (result.accepted && result.focusKey) {
      setEditingKey(result.focusKey);
      setEditingValue(index === 1 ? copy.newFolder : `${copy.newFolder} ${index}`);
    }
  };

  const moveSelectedTo = (targetKey: string): void => {
    applyResult(movePlacementSelection(preview, edits, selected, targetKey));
    setMoveMenuOpen(false);
  };

  const rowKeyboard = (row: InstallPlacementRow, event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      startRename(row);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ' ' && row.sourcePaths.length > 0) {
      event.preventDefault();
      applyResult(setPlacementSelectionIncluded(preview, edits, row.key, !row.included || row.partiallyIncluded));
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      if (row.kind === 'directory') {
        openRowContextMenuFromAnchor(row, event.currentTarget.getBoundingClientRect());
      }
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      selectRow(row, event.shiftKey, event.ctrlKey || event.metaKey);
      return;
    }
    const rowIndex = rows.findIndex((candidate) => candidate.key === row.key);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = rows[rowIndex + 1];
      if (next) focusRow(next.key);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const previous = rows[rowIndex - 1];
      if (previous) focusRow(previous.key);
    } else if (event.key === 'Home') {
      event.preventDefault();
      if (rows[0]) focusRow(rows[0].key);
    } else if (event.key === 'End') {
      event.preventDefault();
      if (rows.at(-1)) focusRow(rows.at(-1)!.key);
    } else if (event.key === 'ArrowRight' && row.kind !== 'file') {
      event.preventDefault();
      if (collapsed.has(row.key)) {
        toggleCollapsed(row.key, false);
      } else {
        const child = rows[rowIndex + 1];
        if (child && child.depth > row.depth) focusRow(child.key);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (row.kind !== 'file' && !collapsed.has(row.key)) {
        toggleCollapsed(row.key, true);
      } else if (row.parentKey) {
        focusRow(row.parentKey);
      }
    }
  };

  return (
    <section className="install-placement-editor" aria-busy={validationPending}>
      <header className="install-placement-toolbar">
        <h3>{copy.title}</h3>
        <div className="install-placement-toolbar__actions">
          <button type="button" className="icon-button" title={copy.undo} aria-label={copy.undo} disabled={disabled || history.past.length === 0} onClick={undo}>
            <Undo2 size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" title={copy.redo} aria-label={copy.redo} disabled={disabled || history.future.length === 0} onClick={redo}>
            <Redo2 size={15} aria-hidden="true" />
          </button>
          <button type="button" className="tool-button" disabled={disabled} onClick={() => createFolder()}>
            <FolderPlus size={15} aria-hidden="true" />{copy.newFolder}
          </button>
          <div className="install-placement-menu-anchor">
            <button type="button" className="tool-button" disabled={disabled || selected.size === 0} onClick={() => setMoveMenuOpen((open) => !open)}>
              <Move size={15} aria-hidden="true" />{copy.moveTo}
            </button>
            {moveMenuOpen ? (
              <div className="install-placement-popover" role="menu">
                <button type="button" role="menuitem" onClick={() => moveSelectedTo('root:data')}>{copy.data}</button>
                <button type="button" role="menuitem" onClick={() => moveSelectedTo('root:gameRoot')}>{preview.gameDisplayName.trim() || copy.gameRoot}</button>
              </div>
            ) : null}
          </div>
          <button type="button" className="tool-button" disabled={disabled || (edits.files.length === 0 && edits.directories.length === 0 && edits.excludedSourcePaths.length === 0)} onClick={() => commit(emptyPlacementEdits())}>
            <RotateCcw size={15} aria-hidden="true" />{copy.reset}
          </button>
        </div>
      </header>

      <div
        ref={treeRef}
        className="install-placement-tree"
        role="tree"
        aria-label={copy.treeLabel}
        data-dragging={draggedKeys.size > 0}
        data-drop-allowed={dropAllowed ?? undefined}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {virtualWindow.topSpacer > 0 ? <div style={{ height: virtualWindow.topSpacer }} aria-hidden="true" /> : null}
        {virtualWindow.items.map((row) => {
          const directory = row.kind === 'directory' || row.kind === 'system-root' || row.kind === 'attention-root';
          const isCollapsed = collapsed.has(row.key);
          const isEditing = editingKey === row.key;
          return (
            <div
              ref={(element) => {
                if (element) rowElementsRef.current.set(row.key, element);
                else rowElementsRef.current.delete(row.key);
              }}
              key={row.key}
              className="install-placement-row"
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={directory ? !isCollapsed : undefined}
              aria-selected={selected.has(row.key)}
              aria-keyshortcuts={row.sourcePaths.length > 0 ? 'Control+Space' : undefined}
              tabIndex={focusedKey === row.key ? 0 : -1}
              data-placement-key={row.key}
              data-kind={row.kind}
              data-selected={selected.has(row.key)}
              data-drop-target={dropTarget === row.key}
              data-drop-allowed={dropTarget === row.key ? dropAllowed : undefined}
              data-blocked={row.blocked}
              data-included={row.included || row.partiallyIncluded}
              data-draggable={!disabled && !row.system && !row.blocked}
              data-drag-source={draggedKeys.has(row.key)}
              style={{ paddingLeft: `${10 + row.depth * 18}px` }}
              onClick={(event) => {
                if (event.detail === 0) {
                  selectRow(row, event.shiftKey, event.ctrlKey || event.metaKey);
                }
              }}
              onFocus={() => setFocusedKey(row.key)}
              onContextMenu={(event) => {
                event.preventDefault();
                selectRow(row, false, false);
                openRowContextMenuAtPoint(row, event.clientX, event.clientY);
              }}
              onKeyDown={(event) => rowKeyboard(row, event)}
              onPointerDown={(event) => beginPointer(row, event)}
              onPointerMove={updatePointer}
              onPointerUp={finishPointer}
              onPointerCancel={cancelPointer}
            >
              {directory ? (
                <button
                  type="button"
                  className="install-placement-row__disclosure"
                  tabIndex={-1}
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); toggleCollapsed(row.key); }}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
              ) : <span className="install-placement-row__disclosure" />}
              <InclusionCheckbox
                row={row}
                label={copy.includeItem(localizedName(row))}
                disabled={disabled}
                onChange={(included) => applyResult(setPlacementSelectionIncluded(preview, edits, row.key, included))}
              />
              {row.blocked ? <AlertTriangle size={15} aria-hidden="true" /> : directory ? <Folder size={15} aria-hidden="true" /> : <File size={15} aria-hidden="true" />}
              {isEditing ? (
                <span className="install-placement-inline-edit">
                  <input
                    autoFocus
                    value={editingValue}
                    aria-invalid={Boolean(editingError)}
                    aria-describedby={editingError ? `${row.key}-error` : undefined}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => { setEditingValue(event.target.value); setEditingError(''); }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Enter') saveRename();
                      if (event.key === 'Escape') { setEditingKey(null); setEditingError(''); }
                    }}
                    onBlur={() => { if (!editingError) saveRename(); }}
                  />
                  {editingError ? <span id={`${row.key}-error`} className="install-placement-inline-error" role="alert">{editingError}</span> : null}
                </span>
              ) : <span className="install-placement-row__name">{localizedName(row)}</span>}
              {row.problemCount > 0 ? <span className="install-placement-row__problem">{copy.problemCount(row.problemCount)}</span> : null}
              {row.kind === 'directory' ? (
                <button
                  type="button"
                  className="install-placement-row__more"
                  tabIndex={-1}
                  aria-haspopup="menu"
                  aria-expanded={rowContextMenu?.key === row.key}
                  aria-label={`${localizedName(row)} menu`}
                  data-install-placement-context-menu-trigger="true"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (rowContextMenu?.key === row.key) {
                      setRowContextMenu(null);
                    } else {
                      openRowContextMenuFromAnchor(row, event.currentTarget.getBoundingClientRect());
                    }
                  }}
                >
                  <MoreHorizontal size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          );
        })}
        {virtualWindow.bottomSpacer > 0 ? <div style={{ height: virtualWindow.bottomSpacer }} aria-hidden="true" /> : null}
      </div>

      {rowContextMenu && contextMenuRow ? createPortal(
        <div
          className="mod-row-menu mod-row-menu--context install-placement-context-menu"
          role="menu"
          aria-label={`${localizedName(contextMenuRow)} actions`}
          data-install-placement-context-menu-surface="true"
          style={{
            left: rowContextMenu.left,
            top: rowContextMenu.top,
            maxHeight: rowContextMenu.maxHeight
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => createFolder(contextMenuRow.key)}>
            {copy.newFolder}
          </button>
          <button type="button" role="menuitem" onClick={() => startRename(contextMenuRow)}>
            {copy.rename}
          </button>
          {contextMenuRow.explicitDirectory ? (
            <button
              type="button"
              role="menuitem"
              className="mod-row-menu__danger"
              onClick={() => {
                applyResult(deleteEmptyPlacementDirectory(preview, edits, contextMenuRow.key));
                setRowContextMenu(null);
              }}
            >
              {copy.delete}
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}

      <div className="install-placement-editor__meta" aria-live="polite">
        <span>{selected.size > 0 ? copy.selectionCount(selected.size) : ''}</span>
        <span className={dropReason ? 'install-placement-editor__reason' : ''}>
          {dropReason || (validationPending ? copy.validating : '')}
        </span>
      </div>
    </section>
  );
}
