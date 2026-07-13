// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

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
// (used by Modal.svelte) aren't implemented at all.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

import RuntimeConsentDialog from './RuntimeConsentDialog.svelte';

describe('RuntimeConsentDialog', () => {
  it('renders the runtime name and size, and calls onDecide(true) on Download & continue', async () => {
    const onDecide = vi.fn();
    const { container } = render(RuntimeConsentDialog, {
      name: 'bun',
      sizeBytes: 42_000_000,
      onDecide,
    });

    expect(screen.getByText('bun')).toBeTruthy();
    expect(container.textContent).toContain('40.1 MB');

    const approveBtn = screen.getByText(/Download & continue/i);
    await fireEvent.click(approveBtn);

    expect(onDecide).toHaveBeenCalledWith(true);
  });

  it('calls onDecide(false) on Decline', async () => {
    const onDecide = vi.fn();
    render(RuntimeConsentDialog, { name: 'uv', sizeBytes: 18_000_000, onDecide });

    const declineBtn = screen.getByText('Decline');
    await fireEvent.click(declineBtn);

    expect(onDecide).toHaveBeenCalledWith(false);
  });
});
