import { describe, expect, it, vi } from 'vitest';

import { requestExecutableSettingsClose } from '../src/renderer/features/executables/executable-settings-close';

describe('executable settings close coordinator', () => {
  it('force-closes immediately when the draft is clean', async () => {
    const openDiscardConfirmation = vi.fn();
    const forceClose = vi.fn(async () => undefined);

    const result = await requestExecutableSettingsClose({
      dirty: false,
      forceClose,
      openDiscardConfirmation
    });

    expect(result).toBe('closed');
    expect(forceClose).toHaveBeenCalledOnce();
    expect(openDiscardConfirmation).not.toHaveBeenCalled();
  });

  it('opens discard confirmation without requesting native close when dirty', async () => {
    const openDiscardConfirmation = vi.fn();
    const forceClose = vi.fn(async () => undefined);

    const result = await requestExecutableSettingsClose({
      dirty: true,
      forceClose,
      openDiscardConfirmation
    });

    expect(result).toBe('confirmation-required');
    expect(openDiscardConfirmation).toHaveBeenCalledOnce();
    expect(forceClose).not.toHaveBeenCalled();
  });
});
