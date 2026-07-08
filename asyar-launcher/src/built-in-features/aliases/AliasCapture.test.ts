// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// jsdom doesn't implement the Web Animations API that Svelte 5 uses to drive
// `transition:fadeIn`/`transition:popupScale` on the modal's backdrop.
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = () =>
    ({
      cancel: () => {},
      finish: () => {},
      finished: Promise.resolve(),
      onfinish: null,
      play: () => {},
      pause: () => {},
    }) as unknown as Animation;
}

// jsdom has no layout/top-layer engine, so HTMLDialogElement.showModal()/close()
// (used by Modal.svelte) aren't implemented at all. Minimal stub so the
// dialog can still open/close for behavioral tests; :modal/focus-trap
// semantics remain untestable here and are verified by running the app.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
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
    // Regression: Enter in the alias input must submit via Modal's onEnter,
    // not get treated as a dialog-level cancel.
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
    input.focus();
    await fireEvent.input(input, { target: { value: 'c' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(oncancel).not.toHaveBeenCalled();
  });

  it('cancels when the dialog fires its native cancel event (Escape)', async () => {
    // Simulates the browser's native Escape-on-modal-<dialog> behavior,
    // which jsdom doesn't implement — dispatch the `cancel` event directly.
    const onsave = vi.fn();
    const oncancel = vi.fn();
    const { container } = render(AliasCapture, {
      objectId: 'obj-1',
      itemName: 'Calculator',
      itemType: 'application',
      onsave,
      oncancel,
    });

    const dialog = container.querySelector('dialog') as HTMLDialogElement;
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));

    expect(oncancel).toHaveBeenCalledTimes(1);
  });
});
