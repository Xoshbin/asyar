// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { CommandArgument } from 'asyar-sdk/contracts';

import CommandArgInput from './CommandArgInput.svelte';

const ARG: CommandArgument = { name: 'who', type: 'text', placeholder: 'Who to greet' };

async function renderChip(
  props: {
    arg?: CommandArgument;
    value?: string;
    readonly?: boolean;
    focused?: boolean;
  } = {},
) {
  const view = render(CommandArgInput, {
    arg: props.arg ?? ARG,
    value: props.value ?? '',
    focused: props.focused ?? false,
    readonly: props.readonly ?? false,
    onInput: vi.fn(),
    onKeydown: vi.fn(),
  });
  await tick();
  return view;
}

describe('CommandArgInput', () => {
  describe('the hint chip', () => {
    // Regression: as an <input>, the chip kept the width it first laid out
    // with. The hint row reuses its elements as the highlight moves, so the
    // previous command's placeholder width clipped this one's ("Who t").
    it('renders the hint as text, not as an input', async () => {
      const view = await renderChip({ readonly: true });
      expect(view.container.querySelector('input')).toBeNull();
      expect(view.container.querySelector('.arg-ghost-text')?.textContent).toBe('Who to greet');
    });

    it('shows a resumed value in place of the hint', async () => {
      const view = await renderChip({ readonly: true, value: 'Wayne' });
      const ghost = view.container.querySelector('.arg-ghost-text');
      expect(ghost?.textContent).toBe('Wayne');
      expect(ghost?.classList.contains('arg-ghost-text--hint')).toBe(false);
    });

    it('masks a password rather than previewing it', async () => {
      const view = await renderChip({
        arg: { name: 'token', type: 'password', placeholder: 'API key' },
        readonly: true,
        value: 'hunter2',
      });
      expect(view.container.querySelector('.arg-ghost-text')?.textContent).toBe('•••••••');
    });

    it('falls back to the argument name when no placeholder is declared', async () => {
      const view = await renderChip({ arg: { name: 'who', type: 'text' }, readonly: true });
      expect(view.container.querySelector('.arg-ghost-text')?.textContent).toBe('who');
    });
  });

  it('is a real input once argument mode owns it', async () => {
    const view = await renderChip();
    const input = view.container.querySelector<HTMLInputElement>('input.arg-input');
    expect(input).not.toBeNull();
    expect(input!.placeholder).toBe('Who to greet');
    expect(view.container.querySelector('.arg-ghost-text')).toBeNull();
  });

  // The launcher's click handler looks this up by attribute to decide where a
  // stray press should leave the caret, so the two halves have to agree on it.
  describe('the marker that says where the caret belongs', () => {
    it('is on the field while it is the one being edited', async () => {
      const view = await renderChip({ focused: true });
      expect(view.container.querySelector('[data-arg-focus-target]')).toBe(
        view.container.querySelector('input.arg-input'),
      );
    });

    it('is absent on a field that is not, and on a hint chip', async () => {
      const unfocused = await renderChip();
      expect(unfocused.container.querySelector('[data-arg-focus-target]')).toBeNull();
      const hint = await renderChip({ readonly: true, focused: true });
      expect(hint.container.querySelector('[data-arg-focus-target]')).toBeNull();
    });
  });

  // Regression: the chip's padding is a plain div, so pressing it dropped
  // focus to the document. The chip opts out of having focus pulled back to
  // the query, so nothing claimed it and the launcher stopped answering the
  // keyboard until the user clicked their way out.
  describe('a press on the chip itself', () => {
    it('keeps focus in the field rather than dropping it', async () => {
      const view = await renderChip();
      const chip = view.container.querySelector<HTMLElement>('.arg-chip')!;
      const input = view.container.querySelector<HTMLInputElement>('input.arg-input')!;

      const press = fireEvent.mouseDown(chip);
      expect(await press).toBe(false); // defaultPrevented: focus never leaves
      expect(document.activeElement).toBe(input);
    });

    it('leaves the field own text alone, so the caret lands where pressed', async () => {
      const view = await renderChip({ value: 'Wayne' });
      const input = view.container.querySelector<HTMLInputElement>('input.arg-input')!;
      expect(await fireEvent.mouseDown(input)).toBe(true);
    });

    it('does not intercept the hint chip, which enters argument mode instead', async () => {
      const view = await renderChip({ readonly: true });
      const chip = view.container.querySelector<HTMLElement>('.arg-chip')!;
      expect(await fireEvent.mouseDown(chip)).toBe(true);
    });
  });

  // Regression: the marker sat on the dropdown's own wrapper, which the click
  // never reaches. The trigger is `pointer-events: none` while the chip is a
  // hint, and the chip's padding is its own, so clicking either bounced focus
  // back to the query. Walking up from the deepest element is what the
  // launcher's click handler does, so it is what these assert.
  describe('opting out of the launcher pulling focus back to the query', () => {
    const DROPDOWN: CommandArgument = {
      name: 'scope',
      type: 'dropdown',
      placeholder: 'Scope',
      data: [{ value: 'all', title: 'All' }],
    };

    it.for([
      ['text field', ARG, false, 'input.arg-input'],
      ['text hint', ARG, true, '.arg-ghost-text'],
      ['dropdown field', DROPDOWN, false, '.arg-trigger'],
      ['dropdown hint', DROPDOWN, true, '.arg-trigger'],
    ] as const)('%s', async ([, arg, readonly, deepest]) => {
      const view = await renderChip({ arg, readonly });
      const el = view.container.querySelector(deepest);
      expect(el).not.toBeNull();
      expect(el!.closest('[data-no-focus-steal]')).toBe(view.container.querySelector('.arg-chip'));
    });
  });

  describe('field width', () => {
    // 7px per character, so a measured width is legible in the assertions.
    function stubTextWidth() {
      return vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return (this.textContent?.length ?? 0) * 7;
      });
    }

    afterEach(() => vi.restoreAllMocks());

    // Regression: sized by `field-sizing: content`, the box fit the text
    // exactly and the caret shoved the value out of view while typing.
    it('measures the value and leaves the caret room past it', async () => {
      stubTextWidth();
      const view = await renderChip({ value: 'abc' });
      expect(view.container.querySelector('.arg-measure-text')?.textContent).toBe('abc');
      expect(view.container.querySelector<HTMLInputElement>('input.arg-input')?.style.width).toBe(
        '24px',
      );
    });

    it('measures the placeholder while the field is empty', async () => {
      stubTextWidth();
      const view = await renderChip();
      expect(view.container.querySelector('.arg-measure-text')?.textContent).toBe('Who to greet');
      expect(view.container.querySelector<HTMLInputElement>('input.arg-input')?.style.width).toBe(
        `${'Who to greet'.length * 7 + 3}px`,
      );
    });

    // Regression: the preview sized itself to its text and the live field
    // added the caret's room, so tabbing in grew every chip.
    it('gives the preview and the field it becomes the same width', async () => {
      stubTextWidth();
      const preview = await renderChip({ readonly: true });
      const live = await renderChip();
      const previewWidth =
        preview.container.querySelector<HTMLElement>('.arg-ghost-text')?.style.width;
      expect(previewWidth).toBe(`${'Who to greet'.length * 7 + 3}px`);
      expect(previewWidth).toBe(
        live.container.querySelector<HTMLInputElement>('input.arg-input')?.style.width,
      );
    });

    it('measures a password at its bullets, not its plaintext', async () => {
      stubTextWidth();
      const view = await renderChip({
        arg: { name: 'token', type: 'password', placeholder: 'API key' },
        value: 'hunter2',
      });
      expect(view.container.querySelector('.arg-measure-text')?.textContent).toBe('•••••••');
    });
  });
});
