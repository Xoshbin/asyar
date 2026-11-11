// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import FormView from './FormView.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

describe('FormView', () => {
  beforeEach(() => {
    actionService.unregisterAction('test:save');
  });

  it('registers a Mod+Enter primary action on mount and unregisters on unmount', () => {
    const onsubmit = vi.fn();
    const { unmount } = render(FormView, {
      props: {
        actionId: 'test:save',
        submitLabel: 'Save Item',
        extensionId: 'snippets',
        onsubmit,
        children: (() => {}) as any,
      },
    });

    const registered = actionService.getAllActions().find((a) => a.id === 'test:save');
    expect(registered).toBeTruthy();
    expect(registered?.shortcut).toBe('Mod+Enter');
    expect(registered?.primary).toBe(true);
    expect(registered?.label).toBe('Save Item');

    unmount();
    expect(actionService.getAllActions().find((a) => a.id === 'test:save')).toBeUndefined();
  });

  it('intercepts Escape via viewManager when oncancel is provided', () => {
    const oncancel = vi.fn();
    const { unmount } = render(FormView, {
      props: {
        actionId: 'test:save',
        submitLabel: 'Save Item',
        onsubmit: vi.fn(),
        oncancel,
        children: (() => {}) as any,
      },
    });

    expect(viewManager.tryInterceptEscape()).toBe(true);
    expect(oncancel).toHaveBeenCalledTimes(1);
    unmount();
  });
});

it('does not schedule search focus when cancellation only closes a picker', () => {
  const frame = vi.spyOn(window, 'requestAnimationFrame');
  render(FormView, {
    actionId: 'test:save',
    submitLabel: 'Save',
    onsubmit: vi.fn(),
    autofocus: false,
    restoreSearchFocusOnCancel: true,
    oncancel: () => false,
    children: (() => {}) as any,
  });
  frame.mockClear();
  expect(viewManager.tryInterceptEscape()).toBe(true);
  expect(frame).not.toHaveBeenCalled();
  frame.mockRestore();
});
