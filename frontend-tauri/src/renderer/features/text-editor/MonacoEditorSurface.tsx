import './monaco-environment';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as monaco from 'monaco-editor';

import { useLocalization } from '../../../localization/react';
import type { TextEditorTab } from './text-editor-model';

export interface TextEditorCursorState {
  line: number;
  column: number;
  selectionCount: number;
  tabSize: number;
  insertSpaces: boolean;
}

export type TextEditorMarkerSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface TextEditorMarker {
  severity: TextEditorMarkerSeverity;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface MonacoEditorSurfaceHandle {
  focus: () => void;
  runAction: (actionId: string) => Promise<void>;
  reveal: (line: number, column?: number, matchLength?: number) => void;
  disposeModel: (tabId: string) => void;
}

interface MonacoEditorSurfaceProps {
  tab: TextEditorTab;
  minimapEnabled: boolean;
  wordWrapEnabled: boolean;
  onChange: (value: string) => void;
  onCursorChange: (state: TextEditorCursorState) => void;
  onMarkersChange: (markers: TextEditorMarker[]) => void;
  onSave: () => void;
}

const registerPapyrusLanguage = () => {
  if (monaco.languages.getLanguages().some((language) => language.id === 'papyrus')) {
    return;
  }

  monaco.languages.register({
    id: 'papyrus',
    aliases: ['Papyrus', 'papyrus'],
    extensions: ['.psc']
  });
  monaco.languages.setLanguageConfiguration('papyrus', {
    comments: { lineComment: ';' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' }
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' }
    ]
  });
  monaco.languages.setMonarchTokensProvider('papyrus', {
    ignoreCase: true,
    keywords: [
      'as', 'auto', 'autoreadonly', 'bool', 'break', 'conditional', 'debugonly',
      'else', 'elseif', 'endEvent', 'endFunction', 'endIf', 'endProperty',
      'endState', 'endWhile', 'event', 'extends', 'false', 'float', 'function',
      'global', 'if', 'import', 'int', 'native', 'new', 'none', 'parent',
      'property', 'return', 'scriptname', 'self', 'state', 'string', 'true',
      'while'
    ],
    tokenizer: {
      root: [
        [/;.*$/, 'comment'],
        [/[a-zA-Z_][\w]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/\d+(?:\.\d+)?/, 'number'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
        [/[{}()[\]]/, '@brackets'],
        [/[=><!~?:&|+\-*\/\^%]+/, 'operator']
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape.invalid'],
        [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
      ]
    }
  });
};

const defineFluxoraTheme = () => {
  monaco.editor.defineTheme('fluxora-dark', {
    base: 'vs-dark',
    inherit: true,
    colors: {
      'editor.background': '#10141A',
      'editor.foreground': '#F5F0E6',
      'editor.lineHighlightBackground': '#161A23',
      'editor.selectionBackground': '#56451F',
      'editor.inactiveSelectionBackground': '#322B1A',
      'editorCursor.foreground': '#EDB848',
      'editorLineNumber.foreground': '#6B6557',
      'editorLineNumber.activeForeground': '#CEC8BA',
      'editorIndentGuide.background1': '#20252E',
      'editorIndentGuide.activeBackground1': '#563F14',
      'editorBracketHighlight.foreground1': '#EDB848',
      'editorBracketHighlight.foreground2': '#8BB6D9',
      'editorBracketHighlight.foreground3': '#B9A7E4',
      'editorGutter.background': '#10141A',
      'editorWidget.background': '#161A23',
      'editorWidget.border': '#313741',
      'editorSuggestWidget.background': '#161A23',
      'editorSuggestWidget.border': '#313741',
      'editorSuggestWidget.selectedBackground': '#292715',
      'editorHoverWidget.background': '#161A23',
      'editorHoverWidget.border': '#313741',
      'editor.findMatchBackground': '#806523',
      'editor.findMatchHighlightBackground': '#4D411F',
      'editorOverviewRuler.border': '#00000000',
      'minimap.background': '#0D1017',
      'scrollbarSlider.background': '#6B655744',
      'scrollbarSlider.hoverBackground': '#948D7E66',
      'scrollbarSlider.activeBackground': '#EDB84866'
    },
    rules: [
      { token: 'comment', foreground: '6F7C70', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'D6A95A' },
      { token: 'number', foreground: 'B8CEA8' },
      { token: 'string', foreground: 'D7A18A' },
      { token: 'type', foreground: '8EC8C8' },
      { token: 'identifier', foreground: 'E4DED2' },
      { token: 'delimiter', foreground: '948D7E' }
    ]
  });
};

const markerSeverity = (severity: monaco.MarkerSeverity): TextEditorMarkerSeverity => {
  if (severity === monaco.MarkerSeverity.Error) {
    return 'error';
  }
  if (severity === monaco.MarkerSeverity.Warning) {
    return 'warning';
  }
  if (severity === monaco.MarkerSeverity.Info) {
    return 'info';
  }
  return 'hint';
};

const markerSnapshot = (model: monaco.editor.ITextModel): TextEditorMarker[] =>
  monaco.editor.getModelMarkers({ resource: model.uri }).map((marker) => ({
    severity: markerSeverity(marker.severity),
    message: marker.message,
    line: marker.startLineNumber,
    column: marker.startColumn,
    endLine: marker.endLineNumber,
    endColumn: marker.endColumn
  }));

const modelUriForTab = (tab: TextEditorTab): monaco.Uri =>
  monaco.Uri.from({
    scheme: 'fluxora-editor',
    authority: 'workspace',
    path: `/${encodeURIComponent(tab.id)}/${encodeURIComponent(tab.fileName)}`
  });

export const MonacoEditorSurface = forwardRef<
  MonacoEditorSurfaceHandle,
  MonacoEditorSurfaceProps
>(function MonacoEditorSurface(
  {
    tab,
    minimapEnabled,
    wordWrapEnabled,
    onChange,
    onCursorChange,
    onMarkersChange,
    onSave
  },
  forwardedRef
) {
  const { t } = useLocalization();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
  const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const activeTabIdRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onMarkersChangeRef = useRef(onMarkersChange);
  const onSaveRef = useRef(onSave);

  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;
  onMarkersChangeRef.current = onMarkersChange;
  onSaveRef.current = onSave;

  useImperativeHandle(forwardedRef, () => ({
    focus: () => editorRef.current?.focus(),
    runAction: async (actionId: string) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      const action = editor.getAction(actionId);
      if (action?.isSupported()) {
        await action.run();
        return;
      }
      editor.trigger('fluxora-workbench', actionId, null);
    },
    reveal: (line: number, column = 1, matchLength = 1) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      const position = { lineNumber: Math.max(1, line), column: Math.max(1, column) };
      editor.setSelection({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column + Math.max(1, matchLength)
      });
      editor.revealPositionInCenter(position, monaco.editor.ScrollType.Smooth);
      editor.focus();
    },
    disposeModel: (tabId: string) => {
      const model = modelsRef.current.get(tabId);
      if (!model) {
        return;
      }
      if (editorRef.current?.getModel() === model) {
        editorRef.current.setModel(null);
      }
      model.dispose();
      modelsRef.current.delete(tabId);
      viewStatesRef.current.delete(tabId);
    }
  }), []);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    registerPapyrusLanguage();
    defineFluxoraTheme();
    const editor = monaco.editor.create(hostRef.current, {
      model: null,
      theme: 'fluxora-dark',
      ariaLabel: t('editor.aria.codeEditor'),
      accessibilitySupport: 'auto',
      automaticLayout: true,
      bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
      contextmenu: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'off',
      detectIndentation: true,
      dragAndDrop: true,
      fixedOverflowWidgets: true,
      folding: true,
      foldingHighlight: true,
      foldingStrategy: 'auto',
      fontFamily: '"IBM Plex Mono", "Cascadia Mono", Consolas, monospace',
      fontLigatures: false,
      fontSize: 13,
      formatOnPaste: true,
      formatOnType: true,
      glyphMargin: true,
      guides: {
        bracketPairs: true,
        bracketPairsHorizontal: true,
        highlightActiveBracketPair: true,
        highlightActiveIndentation: true,
        indentation: true
      },
      largeFileOptimizations: true,
      lineHeight: 21,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      links: true,
      matchBrackets: 'always',
      minimap: { enabled: minimapEnabled, maxColumn: 120, renderCharacters: false },
      mouseWheelZoom: true,
      multiCursorModifier: 'alt',
      overviewRulerBorder: false,
      padding: { top: 10, bottom: 10 },
      renderValidationDecorations: 'on',
      renderWhitespace: 'selection',
      roundedSelection: false,
      scrollBeyondLastLine: false,
      showFoldingControls: 'mouseover',
      smoothScrolling: false,
      stickyScroll: { enabled: true, maxLineCount: 5 },
      suggestOnTriggerCharacters: true,
      tabCompletion: 'on',
      wordBasedSuggestions: 'matchingDocuments',
      wordWrap: wordWrapEnabled ? 'on' : 'off'
    });
    editorRef.current = editor;
    let disposed = false;
    void document.fonts.ready.then(() => {
      if (disposed || editorRef.current !== editor) {
        return;
      }
      monaco.editor.remeasureFonts();
      editor.layout();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current();
    });

    const emitCursorState = () => {
      const position = editor.getPosition();
      if (!position) {
        return;
      }
      const options = editor.getModel()?.getOptions();
      onCursorChangeRef.current({
        line: position.lineNumber,
        column: position.column,
        selectionCount: editor.getSelections()?.length ?? 1,
        tabSize: options?.tabSize ?? 2,
        insertSpaces: options?.insertSpaces ?? true
      });
    };
    const cursorDisposable = editor.onDidChangeCursorPosition(emitCursorState);
    const modelOptionsDisposable = editor.onDidChangeModelOptions(emitCursorState);
    const markerDisposable = monaco.editor.onDidChangeMarkers((resources) => {
      const model = editor.getModel();
      if (!model || !resources.some((resource) => resource.toString() === model.uri.toString())) {
        return;
      }
      onMarkersChangeRef.current(markerSnapshot(model));
    });

    return () => {
      disposed = true;
      cursorDisposable.dispose();
      modelOptionsDisposable.dispose();
      markerDisposable.dispose();
      editor.dispose();
      modelsRef.current.forEach((model) => model.dispose());
      modelsRef.current.clear();
      viewStatesRef.current.clear();
      editorRef.current = null;
    };
  }, [t]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      minimap: { enabled: minimapEnabled, maxColumn: 120, renderCharacters: false },
      wordWrap: wordWrapEnabled ? 'on' : 'off'
    });
  }, [minimapEnabled, wordWrapEnabled]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const previousTabId = activeTabIdRef.current;
    if (previousTabId && previousTabId !== tab.id) {
      viewStatesRef.current.set(previousTabId, editor.saveViewState());
    }

    let model = modelsRef.current.get(tab.id);
    if (!model) {
      model = monaco.editor.createModel(tab.content, tab.languageId, modelUriForTab(tab));
      modelsRef.current.set(tab.id, model);
    } else if (model.getLanguageId() !== tab.languageId) {
      monaco.editor.setModelLanguage(model, tab.languageId);
    }

    const switchedModel = editor.getModel() !== model;
    activeTabIdRef.current = tab.id;
    if (switchedModel) {
      editor.setModel(model);
      const viewState = viewStatesRef.current.get(tab.id);
      if (viewState) {
        editor.restoreViewState(viewState);
      }
    }
    onMarkersChangeRef.current(markerSnapshot(model));
    const position = editor.getPosition() ?? { lineNumber: 1, column: 1 };
    const options = model.getOptions();
    onCursorChangeRef.current({
      line: position.lineNumber,
      column: position.column,
      selectionCount: editor.getSelections()?.length ?? 1,
      tabSize: options.tabSize,
      insertSpaces: options.insertSpaces
    });

    const contentDisposable = model.onDidChangeContent(() => {
      if (activeTabIdRef.current === tab.id) {
        onChangeRef.current(model.getValue());
      }
    });
    const layoutFrame = switchedModel
      ? requestAnimationFrame(() => {
          editor.layout();
          editor.focus();
        })
      : null;

    return () => {
      contentDisposable.dispose();
      if (layoutFrame !== null) {
        cancelAnimationFrame(layoutFrame);
      }
    };
  }, [tab.id, tab.languageId]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: tab.state === 'loading' || tab.readOnly === true });
  }, [tab.readOnly, tab.state]);

  return <div className="text-editor-monaco" ref={hostRef} />;
});
