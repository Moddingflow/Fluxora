import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { FluxoraAiContextUsage } from '../src/shared/fluxora-api';
import { AiContextGauge } from '../src/renderer/features/ai/AiContextGauge';
import { approximateAiContextUsage } from '../src/renderer/features/ai/ai-chat-runtime';
import { renderLocalized } from './localization-test-utils';

const usage = (overrides: Partial<FluxoraAiContextUsage> = {}): FluxoraAiContextUsage => ({
  schema: 'fluxora.ai.context-usage.v2',
  operationId: 'operation-1',
  providerId: 'gemini',
  modelId: 'gemini-3.1-flash-lite',
  contextWindowTokens: 1_048_576,
  modelInputTokenLimit: 1_048_576,
  modelOutputTokenLimit: 65_536,
  currentContextTokens: 2_336,
  currentContextPercent: 0.22,
  precision: 'exact',
  level: 'normal',
  mode: 'full',
  includedSections: ['messages'],
  autoCompressionApplied: false,
  actionRequired: false,
  countedAt: new Date().toISOString(),
  ...overrides
});

const RING_LENGTH = 2 * Math.PI * 8;

const dashOffset = (html: string): number => {
  const match = html.match(/stroke-dashoffset="([\d.]+)"/);
  expect(match).not.toBeNull();
  return Number(match?.[1]);
};

describe('ai context gauge', () => {
  it('draws the filled share of the window and keeps the numbers in the label', () => {
    const html = renderLocalized(createElement(AiContextGauge, { usage: usage() }), 'ru-RU');

    expect(html).toContain('role="img"');
    expect(html).toContain('Использовано контекста:');
    expect(html).toMatch(/2.336 \/ 1.048.576 токенов \(0,2%\)/);
    expect(html).toContain('Лимит вывода:');
    // Nearly empty window: the arc is hidden behind almost the full offset.
    expect(dashOffset(html)).toBeCloseTo(RING_LENGTH * (1 - 0.0022), 2);
  });

  it('fills further and changes tone as the window fills', () => {
    const half = renderLocalized(
      createElement(AiContextGauge, { usage: usage({ currentContextPercent: 50, level: 'moderate' }) }),
      'en-US'
    );
    const full = renderLocalized(
      createElement(AiContextGauge, {
        usage: usage({ currentContextPercent: 98, level: 'almost-full' })
      }),
      'en-US'
    );

    expect(dashOffset(half)).toBeCloseTo(RING_LENGTH * 0.5, 2);
    expect(dashOffset(full)).toBeLessThan(dashOffset(half));
    expect(half).toContain('data-level="moderate"');
    expect(full).toContain('data-level="almost-full"');
  });

  it('stays out of the composer until a count exists', () => {
    expect(renderLocalized(createElement(AiContextGauge, { usage: null }), 'en-US')).toBe('');
  });

  it('counts the message being typed, weighting non-latin text like the host does', () => {
    const base = usage({ currentContextTokens: 1_000, currentContextPercent: 0.1 });
    const latin = approximateAiContextUsage(base, 'stability of the build');
    const cyrillic = approximateAiContextUsage(base, 'стабильность сборки');

    expect(latin?.currentContextTokens).toBeGreaterThan(1_000);
    expect(cyrillic?.currentContextTokens).toBeGreaterThan(latin?.currentContextTokens ?? 0);
    expect(latin?.precision).toBe('estimated');
    expect(approximateAiContextUsage(base, '   ')).toBe(base);
  });
});
