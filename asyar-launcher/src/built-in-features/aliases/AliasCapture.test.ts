// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// jsdom doesn't implement the Web Animations API that Svelte 5 uses to drive
// `transition:fadeIn`/`transition:popupScale` on the modal's backdrop.
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = () => ({
    cancel: () => {},
    finish: () => {},
    finished: Promise.resolve(),
    onfinish: null,
    play: () => {},
    pause: () => {},
  }) as unknown as Animation;
}

// AliasCapture imports Button/Input/FormField from the `../../components`
// barrel, which re-exports the entire component tree (ActionListPopup,
// DialogHost, etc.) and transitively drags in Tauri-backed services that
// blow up under a plain jsdom test. Point the barrel at just the three real,
// dependency-free leaf components AliasCapture actually uses.
vi.mock('../../components', async () => ({
  Button: (await import('../../components/base/Button.svelte')).default,
  Input: (await import('../../components/base/Input.svelte')).default,
  FormField: (await import('../../components/form/FormField.svelte')).default,
}));

vi.mock('./aliasService', () => ({
  aliasService: {
    register: vi.fn(),
    findConflict: vi.fn(),
  },
}));

vi.mock('./aliasStore.svelte', () => ({
  aliasStore: {
    addOptimistic: vi.fn(),
  },
}));

vi.mock('../../services/log/logService', () => ({
  logService: {
    error: vi.fn(),
  },
}));

import AliasCapture from './AliasCapture.svelte';
import { aliasService } from './aliasService';

const mockedAliasService = vi.mocked(aliasService);

describe('AliasCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAliasService.findConflict.mockResolvedValue(null);
    mockedAliasService.register.mockResolvedValue({
      objectId: 'obj-1',
      alias: 'c',
      itemName: 'Calculator',
      itemType: 'application',
    } as any);
  });

  it('saves (does not cancel) when Enter is pressed after typing a valid alias', async () => {
    // Regression: pressing Enter in the alias input used to bubble up to the
    // backdrop's keydown handler, which had no target-equality guard (unlike
    // its own click handler), so it fired oncancel() instead of letting the
    // form submit.
    const onsave = vi.fn();
    const oncancel = vi.fn();
    const { container } = render(AliasCapture, {
      objectId: 'obj-1',
      itemName: 'Calculator',
      itemType: 'application',
      onsave,
      oncancel,
    });

    const input = container.querySelector('input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'c' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(oncancel).not.toHaveBeenCalled();
  });

  it('still cancels when Enter is pressed directly on the backdrop (keyboard-activated dismiss)', async () => {
    const onsave = vi.fn();
    const oncancel = vi.fn();
    const { container } = render(AliasCapture, {
      objectId: 'obj-1',
      itemName: 'Calculator',
      itemType: 'application',
      onsave,
      oncancel,
    });

    const backdrop = container.querySelector('[role="button"][tabindex="0"]') as HTMLElement;
    await fireEvent.keyDown(backdrop, { key: 'Enter' });

    expect(oncancel).toHaveBeenCalledTimes(1);
  });
});
