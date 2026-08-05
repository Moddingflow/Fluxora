import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const styles = fs
  .readFileSync(path.join(repoRoot, 'frontend-tauri', 'src', 'renderer', 'styles.css'), 'utf8')
  // Comments would otherwise break the "what precedes a selector" match below.
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Specificity of a selector as [ids, classes+attributes+pseudo-classes, elements].
 * Only the shapes used by the row rules below need to be understood.
 */
const specificity = (selector: string): [number, number, number] => [
  (selector.match(/#[\w-]+/g) ?? []).length,
  (selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+(?!:)/g) ?? []).length,
  (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
];

interface Rule {
  selector: string;
  index: number;
}

const rulesFor = (selector: string): Rule[] => {
  const matches: Rule[] = [];
  const pattern = new RegExp(
    `(^|[,{}])\\s*(${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*(?=[,{])`,
    'g'
  );
  for (let match = pattern.exec(styles); match; match = pattern.exec(styles)) {
    matches.push({ selector: match[2], index: match.index });
  }
  return matches;
};

/** True when `winner` beats `loser` under the cascade (equal specificity => later wins). */
const winsCascade = (winner: string, loser: string): boolean => {
  const winners = rulesFor(winner);
  const losers = rulesFor(loser);
  expect(winners.length, `no rule found for ${winner}`).toBeGreaterThan(0);
  expect(losers.length, `no rule found for ${loser}`).toBeGreaterThan(0);

  return winners.some((winningRule) =>
    losers.every((losingRule) => {
      const winningWeight = specificity(winningRule.selector);
      const losingWeight = specificity(losingRule.selector);
      for (let level = 0; level < 3; level += 1) {
        if (winningWeight[level] !== losingWeight[level]) {
          return winningWeight[level] > losingWeight[level];
        }
      }
      return winningRule.index > losingRule.index;
    })
  );
};

describe('separator rows show multi-selection', () => {
  it('paints selected plugin separators over their own separator tint', () => {
    // A separator row carries its own background at the same weight as the
    // generic selected-row rule. Without a dedicated selected-separator rule the
    // highlight loses the cascade, and a shift- or ctrl-click across separators
    // looks like nothing happened even though the rows really are selected.
    expect(
      winsCascade('.mod-row[data-separator="true"][data-selected="true"]', '.mod-row[data-separator="true"]')
    ).toBe(true);
    expect(
      winsCascade(
        '.mod-row[data-separator="true"][data-collapsed="true"][data-selected="true"]',
        '.mod-row[data-separator="true"][data-collapsed="true"]'
      )
    ).toBe(true);
  });

  it('paints selected mod separators over their own separator tint', () => {
    expect(winsCascade('.mod-list-row--separator[data-selected="true"]', '.mod-list-row--separator')).toBe(
      true
    );
    expect(
      winsCascade('.mod-list-row--separator[data-selected="true"]', '.mod-list-row--separator[data-collapsed="true"]')
    ).toBe(true);
  });
});
