/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { isActionableElementFocused, isAnyModalOpen, getFirstFocusable } from './Modal.logic';

describe('isActionableElementFocused', () => {
  it('returns false for null', () => {
    expect(isActionableElementFocused(null)).toBe(false);
  });

  it('returns false for the document body', () => {
    expect(isActionableElementFocused(document.body)).toBe(false);
  });

  it('returns false for a plain text input (Enter-to-submit must keep working)', () => {
    const input = document.createElement('input');
    expect(isActionableElementFocused(input)).toBe(false);
  });

  it('returns true for a button element', () => {
    const button = document.createElement('button');
    expect(isActionableElementFocused(button)).toBe(true);
  });

  it('returns true for an element with role="button"', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'button');
    expect(isActionableElementFocused(div)).toBe(true);
  });

  it('returns true for a link', () => {
    const anchor = document.createElement('a');
    anchor.href = '#';
    expect(isActionableElementFocused(anchor)).toBe(true);
  });

  it('returns true for a textarea (Enter should insert a newline, not submit)', () => {
    const textarea = document.createElement('textarea');
    expect(isActionableElementFocused(textarea)).toBe(true);
  });

  it('returns true for a select (Enter picks the highlighted option when open)', () => {
    const select = document.createElement('select');
    expect(isActionableElementFocused(select)).toBe(true);
  });

  it.each(['submit', 'button', 'reset', 'file'])(
    'returns true for an input[type="%s"] (button-like, owns its own Enter/activation)',
    (type) => {
      const input = document.createElement('input');
      input.type = type;
      expect(isActionableElementFocused(input)).toBe(true);
    },
  );

  it('returns false for input[type="text"] (must not be swept up by the button-like check)', () => {
    const input = document.createElement('input');
    input.type = 'text';
    expect(isActionableElementFocused(input)).toBe(false);
  });

  it('returns true for a contenteditable element (Enter inserts a line break, not submit)', () => {
    // jsdom doesn't implement contentEditable/isContentEditable at all
    // (setting .contentEditable is a silent no-op, isContentEditable stays
    // undefined) — same class of gap as :modal/showModal. Fake the IDL
    // property directly; the implementation reads the real one in browsers.
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isActionableElementFocused(div)).toBe(true);
  });
});

describe('isAnyModalOpen', () => {
  // jsdom has no real layout/top-layer engine, so a <dialog> element's
  // showModal()/:modal state can never be exercised truthfully here (verified:
  // dialog.showModal is undefined and .matches(':modal') always returns false
  // in jsdom 29, even with the open attribute set). Test the delegation logic
  // with a fake Document instead; the real platform behavior is verified
  // manually in the running app.
  it('returns false when no element matches :modal', () => {
    const fakeDoc = { querySelector: vi.fn().mockReturnValue(null) };
    expect(isAnyModalOpen(fakeDoc as unknown as Document)).toBe(false);
    expect(fakeDoc.querySelector).toHaveBeenCalledWith(':modal');
  });

  it('returns true when an element matches :modal', () => {
    const fakeDoc = { querySelector: vi.fn().mockReturnValue(document.createElement('dialog')) };
    expect(isAnyModalOpen(fakeDoc as unknown as Document)).toBe(true);
  });
});

describe('getFirstFocusable', () => {
  // WebKit's native <dialog> focus trap can drop focus outside the dialog
  // (or to document.body) while tabbing — a documented engine bug, not
  // something specific to this app. Modal.svelte uses this to find a
  // fallback focus target to pull focus back to when that happens.
  it('returns null when there are no focusable descendants', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>text</p><span>more</span>';
    expect(getFirstFocusable(container)).toBeNull();
  });

  it('returns the first focusable element in document order', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>text</p><button id="a">A</button><button id="b">B</button>';
    expect(getFirstFocusable(container)?.id).toBe('a');
  });

  it('skips disabled buttons', () => {
    const container = document.createElement('div');
    container.innerHTML = '<button disabled id="skip">Skip</button><button id="real">Real</button>';
    expect(getFirstFocusable(container)?.id).toBe('real');
  });

  it('skips elements with tabindex="-1"', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div tabindex="-1" id="skip">Skip</div><button id="real">Real</button>';
    expect(getFirstFocusable(container)?.id).toBe('real');
  });

  it('finds links and textareas too', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a id="link" href="#">Link</a>';
    expect(getFirstFocusable(container)?.id).toBe('link');
  });
});
