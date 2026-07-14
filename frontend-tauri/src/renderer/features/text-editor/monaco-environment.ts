import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

interface MonacoWorkerEnvironment {
  getWorker: (moduleId: string, label: string) => Worker;
}

const workerScope = self as typeof self & {
  MonacoEnvironment?: MonacoWorkerEnvironment;
};

workerScope.MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === 'json') {
      return new JsonWorker();
    }
    if (label === 'css' || label === 'less' || label === 'scss') {
      return new CssWorker();
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new HtmlWorker();
    }
    if (label === 'javascript' || label === 'typescript') {
      return new TypeScriptWorker();
    }
    return new EditorWorker();
  }
};
