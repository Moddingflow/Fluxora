import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoots = ['src/renderer', 'src/installer'];
const userFacingAttributes = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'placeholder',
  'title'
]);
const userFacingProperties = new Set([
  'ariaLabel',
  'body',
  'caption',
  'description',
  'detail',
  'emptyLabel',
  'error',
  'errorMessage',
  'heading',
  'label',
  'message',
  'placeholder',
  'reason',
  'statusText',
  'success',
  'text',
  'title',
  'tooltip',
  'userMessage',
  'validationMessage'
]);
const userFacingCalls = new Set([
  'alert',
  'confirm',
  'finishOperationOverlay',
  'pickExecutable',
  'pickFolder',
  'saveExecutableList',
  'setError',
  'setMessage',
  'setStatus',
  'setWarning'
]);
const copyFunctionNamePattern = /(?:Error|Label|Message|Text|Title|_(?:ERROR|LABEL|MESSAGE|TEXT|TITLE))$/u;

const sourceFiles = (): string[] => {
  const files: string[] = [];
  const visitDirectory = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(entryPath);
      } else if (/\.tsx?$/u.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(entryPath);
      }
    }
  };

  for (const root of sourceRoots) {
    visitDirectory(root);
  }
  return files;
};

const propertyName = (node: ts.PropertyName): string =>
  ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : '';

const callName = (expression: ts.Expression): string => {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return '';
};

const functionLikeName = (node: ts.SignatureDeclaration): string => {
  if ('name' in node && node.name && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  const parent = node.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : '';
};

const nearestCopyContext = (node: ts.Node): 'jsx' | 'call' | 'return' | null => {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      copyFunctionNamePattern.test(current.name.text)
    ) {
      return 'return';
    }
    if (
      ts.isParameter(current) &&
      ts.isIdentifier(current.name) &&
      copyFunctionNamePattern.test(current.name.text)
    ) {
      return 'return';
    }
    if (ts.isFunctionLike(current)) {
      return ts.isArrowFunction(current) && !ts.isBlock(current.body) &&
        copyFunctionNamePattern.test(functionLikeName(current))
        ? 'return'
        : null;
    }
    if (ts.isJsxAttribute(current) && ts.isIdentifier(current.name)) {
      const name = current.name.text;
      return userFacingAttributes.has(name) || userFacingProperties.has(name) ? 'jsx' : null;
    }
    if (ts.isPropertyAssignment(current)) {
      const name = propertyName(current.name);
      return userFacingProperties.has(name) && name !== 'reason' ? 'jsx' : null;
    }
    if (ts.isBinaryExpression(current)) {
      if (ts.isArrowFunction(current.parent) && current.parent.body === current &&
        copyFunctionNamePattern.test(functionLikeName(current.parent))
      ) {
        return 'return';
      }
      if (
        current.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
        current.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
      ) {
        return null;
      }
    }
    if (ts.isJsxExpression(current)) {
      if (ts.isJsxAttribute(current.parent) && ts.isIdentifier(current.parent.name)) {
        const name = current.parent.name.text;
        return userFacingAttributes.has(name) || userFacingProperties.has(name) ? 'jsx' : null;
      }
      return 'jsx';
    }
    if (ts.isCallExpression(current)) {
      const name = callName(current.expression);
      return userFacingCalls.has(name) ||
        /^set[A-Z].*(?:BusyLabel|Error|Message|Status|Warning)$/u.test(name) ||
        /^run[A-Z].*Mutation$/u.test(name)
        ? 'call'
        : null;
    }
    if (ts.isReturnStatement(current)) {
      let owner: ts.Node | undefined = current.parent;
      while (owner && !ts.isFunctionLike(owner)) {
        owner = owner.parent;
      }
      return owner && ts.isFunctionLike(owner) && copyFunctionNamePattern.test(functionLikeName(owner))
        ? 'return'
        : null;
    }
    current = current.parent;
  }
  return null;
};

const hasUiLogAncestor = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isCallExpression(current) && (
        (ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === 'log') ||
        (ts.isIdentifier(current.expression) && current.expression.text === 'logAiRuntimeEntry')
      )
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const isHumanCopy = (value: string): boolean => {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (/^(?:B|KB|MB|GB)$/u.test(normalized)) {
    return false;
  }
  const tokens = normalized.split(' ');
  if (
    tokens.length > 0 &&
    tokens.every((token) => /^[-_a-z0-9]+$/iu.test(token)) &&
    tokens.every((token) => /[-_]/u.test(token))
  ) {
    return false;
  }
  if (/^\(?(?:(?:Control|Ctrl|Shift|Alt|Meta)\+)+(?:[A-Z0-9]+)\)?$/iu.test(normalized)) {
    return false;
  }
  if (/^event=\s*chatId=\s*provider=\s*model=$/u.test(normalized)) {
    return false;
  }
  return /[A-Za-zА-Яа-яЁё]/u.test(normalized) &&
    !/^[a-z][a-z0-9]*(?:[._:/-][a-z0-9-]+)+$/iu.test(normalized);
};

const userFacingLiterals = (file: string): string[] => {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const findings: string[] = [];
  const add = (node: ts.Node, value: string) => {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (!isHumanCopy(normalized)) {
      return;
    }
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    findings.push(`${file.replaceAll('\\', '/')}:${line}: ${normalized}`);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      add(node, node.text);
    } else if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      ts.isIdentifier(node.name) &&
      userFacingAttributes.has(node.name.text)
    ) {
      add(node, node.initializer.text);
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      if (hasUiLogAncestor(node)) {
        return;
      }
      const parent = node.parent;
      const value = ts.isTemplateExpression(node)
        ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ')
        : node.text;
      if (ts.isJsxExpression(parent)) {
        if (
          !ts.isJsxAttribute(parent.parent) ||
          (ts.isIdentifier(parent.parent.name) && (
            userFacingAttributes.has(parent.parent.name.text) ||
            userFacingProperties.has(parent.parent.name.text)
          ))
        ) {
          add(node, value);
        }
      } else if (
        ts.isPropertyAssignment(parent) &&
        userFacingProperties.has(propertyName(parent.name)) &&
        (propertyName(parent.name) !== 'reason' || /\s|[.!?]/u.test(value)) &&
        !hasUiLogAncestor(node)
      ) {
        add(node, value);
      } else if (
        ts.isCallExpression(parent) &&
        userFacingCalls.has(callName(parent.expression))
      ) {
        add(node, value);
      } else if (
        ts.isNewExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === 'Error' &&
        file.endsWith('.tsx')
      ) {
        add(node, value);
      } else if (nearestCopyContext(node)) {
        add(node, value);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
};

describe('localized product source', () => {
  it('keeps user-facing copy in locale resources instead of TypeScript and JSX', () => {
    const findings = sourceFiles().flatMap(userFacingLiterals);
    expect(findings, findings.join('\n')).toEqual([]);
  });
});
