// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { CommandArgument } from 'asyar-sdk/contracts';

import ArgumentChipRow from './ArgumentChipRow.svelte';
import type { ActiveArgumentMode } from '../../services/search/commandArgumentsService.svelte';

const ARGS: CommandArgument[] = [
  { name: 'hours', type: 'number' },
  { name: 'minutes', type: 'number' },
  { name: 'seconds', type: 'number' },
];

function makeActive(overrides: Partial<ActiveArgumentMode> = {}): ActiveArgumentMode {
  return {
    commandObjectId: 'cmd_org.asyar.coffee_caffeinate-for',
    extensionId: 'org.asyar.coffee',
    commandId: 'caffeinate-for',
    isDynamic: false,
    isBuiltIn: false,
    title: 'Caffeinate For',
    args: ARGS,
    values: { hours: '', minutes: '', seconds: '' },
    seeds: { hours: '', minutes: '', seconds: '' },
    edited: new Set<string>(),
    visited: new Set<string>(),
    currentFieldIdx: 0,
    submitRefused: false,
    ...overrides,
  };
}

async function renderRow(active: ActiveArgumentMode) {
  const handlers = {
    onValueChange: vi.fn(),
    onValueReset: vi.fn(),
    onFocusField: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onSubmit: vi.fn(),
    onExit: vi.fn(),
    onMoveToQuery: vi.fn(),
  };
  const view = render(ArgumentChipRow, { active, ...handlers });
  // Let the focus-and-select effect settle, so tests set selection state on a
  // field the component has finished touching. Taking focus reports the field
  // it landed on, so forget that arrival: what each test measures is where the
  // keystroke under it moved the row, not where the row started.
  await tick();
  handlers.onFocusField.mockClear();
  const inputs = Array.from(view.container.querySelectorAll<HTMLInputElement>('input.arg-input'));
  return { ...handlers, inputs, view };
}

describe('ArgumentChipRow', () => {
  // Regression: per-field `bind:this` into a reactive array writes state
  // mid-render, which tears the component down and blanks the launcher.
  it('renders one input per declared argument without erroring', async () => {
    const { inputs } = await renderRow(makeActive());
    expect(inputs).toHaveLength(3);
    expect(inputs.map((i) => i.placeholder)).toEqual(['hours', 'minutes', 'seconds']);
  });

  it('renders the fields alone, with no command chip', async () => {
    const { view } = await renderRow(makeActive());
    expect(view.container.textContent).not.toContain('Caffeinate For');
    expect(view.container.querySelector('button')).toBeNull();
  });

  // Regression: the row tracked its own index and only updated it from the
  // keyboard walk, so clicking into a chip left the ring on the field before
  // it, and the next Tab stepped off that one, landing back where the caret
  // already was.
  it('follows the caret into a field it did not send it to', async () => {
    const { inputs, onFocusField } = await renderRow(makeActive());

    inputs[1].focus();

    expect(onFocusField).toHaveBeenCalledWith(1);
  });

  it('reports a dropdown trigger taking focus the same way', async () => {
    const active = makeActive({
      args: [
        { name: 'text', type: 'text' },
        { name: 'scope', type: 'dropdown', data: [{ value: 'all', title: 'All' }] },
      ],
      values: { text: '', scope: '' },
      seeds: { text: '', scope: '' },
    });
    const { view, onFocusField } = await renderRow(active);

    view.container.querySelector<HTMLButtonElement>('.arg-trigger')!.focus();

    expect(onFocusField).toHaveBeenCalledWith(1);
  });

  it('Tab steps to the next field', async () => {
    const { inputs, onNext, onMoveToQuery } = await renderRow(makeActive());
    await fireEvent.keyDown(inputs[0], { key: 'Tab' });
    expect(onNext).toHaveBeenCalled();
    expect(onMoveToQuery).not.toHaveBeenCalled();
  });

  it('Tab off the last field returns to the query rather than wrapping', async () => {
    const { inputs, onNext, onMoveToQuery } = await renderRow(makeActive({ currentFieldIdx: 2 }));
    await fireEvent.keyDown(inputs[2], { key: 'Tab' });
    expect(onMoveToQuery).toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('Shift+Tab off the first field returns to the query instead of exiting', async () => {
    const { inputs, onPrev, onExit, onMoveToQuery } = await renderRow(makeActive());
    await fireEvent.keyDown(inputs[0], { key: 'Tab', shiftKey: true });
    expect(onMoveToQuery).toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it('Shift+Tab in a later field steps back one', async () => {
    const { inputs, onPrev, onMoveToQuery } = await renderRow(makeActive({ currentFieldIdx: 1 }));
    await fireEvent.keyDown(inputs[1], { key: 'Tab', shiftKey: true });
    expect(onPrev).toHaveBeenCalled();
    expect(onMoveToQuery).not.toHaveBeenCalled();
  });

  it('a lone argument toggles between the query and its field', async () => {
    const single = makeActive({
      args: [{ name: 'query', type: 'text' }],
      values: { query: '' },
      currentFieldIdx: 0,
    });
    const { inputs, onMoveToQuery, onNext, onPrev } = await renderRow(single);
    await fireEvent.keyDown(inputs[0], { key: 'Tab' });
    await fireEvent.keyDown(inputs[0], { key: 'Tab', shiftKey: true });
    expect(onMoveToQuery).toHaveBeenCalledTimes(2);
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it('ArrowRight at the end of a field moves to the next one', async () => {
    const { inputs, onFocusField } = await renderRow(makeActive());
    inputs[0].setSelectionRange(0, 0);
    await fireEvent.keyDown(inputs[0], { key: 'ArrowRight' });
    expect(onFocusField).toHaveBeenCalledWith(1);
  });

  it('ArrowRight in the last field does not wrap', async () => {
    const { inputs, onFocusField } = await renderRow(makeActive({ currentFieldIdx: 2 }));
    inputs[2].setSelectionRange(0, 0);
    await fireEvent.keyDown(inputs[2], { key: 'ArrowRight' });
    expect(onFocusField).not.toHaveBeenCalled();
  });

  it('ArrowLeft at the start of the first field falls back to the query', async () => {
    const { inputs, onMoveToQuery, onFocusField } = await renderRow(makeActive());
    inputs[0].setSelectionRange(0, 0);
    await fireEvent.keyDown(inputs[0], { key: 'ArrowLeft' });
    expect(onMoveToQuery).toHaveBeenCalledTimes(1);
    expect(onFocusField).not.toHaveBeenCalled();
  });

  it('ArrowRight on a selected value drops the caret before stepping fields', async () => {
    const values = { hours: '12', minutes: '', seconds: '' };
    const { inputs, onFocusField } = await renderRow(makeActive({ values }));
    // Whole value selected, as it is on arrow-key arrival.
    inputs[0].setSelectionRange(0, 2);
    await fireEvent.keyDown(inputs[0], { key: 'ArrowRight' });
    expect(onFocusField).not.toHaveBeenCalled();
    expect(inputs[0].selectionStart).toBe(2);

    // Caret now at the end, so the next press crosses into the next field.
    await fireEvent.keyDown(inputs[0], { key: 'ArrowRight' });
    expect(onFocusField).toHaveBeenCalledWith(1);
  });

  it('ArrowLeft on a selected value steps straight to the previous field', async () => {
    const values = { hours: '', minutes: '34', seconds: '' };
    const { inputs, onFocusField } = await renderRow(makeActive({ values, currentFieldIdx: 1 }));
    inputs[1].setSelectionRange(0, 2);
    await fireEvent.keyDown(inputs[1], { key: 'ArrowLeft' });
    // No collapse-to-start step: leftward travel is one press per field.
    expect(onFocusField).toHaveBeenCalledWith(0);
  });

  it('leaves caret movement inside a value to the browser', async () => {
    const values = { hours: '12', minutes: '', seconds: '' };
    const { inputs, onFocusField, onMoveToQuery } = await renderRow(makeActive({ values }));
    inputs[0].setSelectionRange(1, 1);
    await fireEvent.keyDown(inputs[0], { key: 'ArrowLeft' });
    expect(onFocusField).not.toHaveBeenCalled();
    expect(onMoveToQuery).not.toHaveBeenCalled();
  });

  describe('with a dropdown in the row', () => {
    const MIXED: CommandArgument[] = [
      { name: 'query', type: 'text' },
      {
        name: 'scope',
        type: 'dropdown',
        data: [
          { value: 'active', title: 'Active' },
          { value: 'all', title: 'All' },
        ],
      },
    ];

    function makeMixed(overrides: Partial<ActiveArgumentMode> = {}) {
      return makeActive({
        args: MIXED,
        values: { query: '', scope: 'active' },
        seeds: { query: '', scope: 'active' },
        ...overrides,
      });
    }

    async function renderMixed(active: ActiveArgumentMode) {
      const view = await renderRow(active);
      const trigger = view.view.container.querySelector<HTMLButtonElement>('.arg-trigger')!;
      return { ...view, trigger };
    }

    it('walks fields with one press each way, having no caret to cross', async () => {
      const { trigger, onFocusField } = await renderMixed(makeMixed({ currentFieldIdx: 1 }));
      await fireEvent.keyDown(trigger, { key: 'ArrowLeft' });
      expect(onFocusField).toHaveBeenCalledWith(0);
    });

    it('ArrowRight in a trailing dropdown does not wrap', async () => {
      const { trigger, onFocusField, onMoveToQuery } = await renderMixed(
        makeMixed({ currentFieldIdx: 1 }),
      );
      await fireEvent.keyDown(trigger, { key: 'ArrowRight' });
      expect(onFocusField).not.toHaveBeenCalled();
      expect(onMoveToQuery).not.toHaveBeenCalled();
    });

    it('Tab off a trailing dropdown returns to the query', async () => {
      const { trigger, onMoveToQuery } = await renderMixed(makeMixed({ currentFieldIdx: 1 }));
      await fireEvent.keyDown(trigger, { key: 'Tab' });
      expect(onMoveToQuery).toHaveBeenCalled();
    });

    it('Down picks the first option, and Up off it resets the field', async () => {
      const active = makeMixed({ currentFieldIdx: 1 });
      const { trigger, onValueChange, onValueReset } = await renderMixed(active);
      await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      expect(onValueChange).toHaveBeenCalledWith('scope', 'active');

      const picked = await renderMixed(
        makeMixed({ currentFieldIdx: 1, edited: new Set(['scope']) }),
      );
      await fireEvent.keyDown(picked.trigger, { key: 'ArrowUp' });
      expect(picked.onValueReset).toHaveBeenCalledWith('scope');
      expect(onValueReset).not.toHaveBeenCalled();
    });

    it('Enter still submits from a dropdown rather than opening it', async () => {
      const { trigger, onSubmit } = await renderMixed(makeMixed({ currentFieldIdx: 1 }));
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(onSubmit).toHaveBeenCalled();
    });
  });
});
