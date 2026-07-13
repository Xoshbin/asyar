// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Input from './Input.svelte';
import Textarea from './Textarea.svelte';
import type { TextIntent } from './textIntent';

const controls = [
  {
    name: 'Input',
    renderControl(textIntent?: TextIntent) {
      const { container } = render(Input, textIntent ? { textIntent } : {});
      return container.querySelector('input');
    },
  },
  {
    name: 'Textarea',
    renderControl(textIntent?: TextIntent) {
      const { container } = render(Textarea, textIntent ? { textIntent } : {});
      return container.querySelector('textarea');
    },
  },
] as const;

describe('text control intents', () => {
  it.each(controls)('$name follows native text behavior by default', ({ renderControl }) => {
    const control = renderControl();

    expect(control?.getAttribute('autocapitalize')).toBeNull();
    expect(control?.getAttribute('autocorrect')).toBeNull();
    expect(control?.getAttribute('spellcheck')).toBeNull();
  });

  it.each(controls)('$name protects exact text from automatic changes', ({ renderControl }) => {
    const control = renderControl('exact');

    expect(control?.getAttribute('autocapitalize')).toBe('none');
    expect(control?.getAttribute('autocorrect')).toBe('off');
    expect(control?.getAttribute('spellcheck')).toBe('false');
  });

  it.each(controls)('$name proofreads verbatim prose without changing it', ({ renderControl }) => {
    const control = renderControl('verbatim');

    expect(control?.getAttribute('autocapitalize')).toBe('none');
    expect(control?.getAttribute('autocorrect')).toBe('off');
    expect(control?.getAttribute('spellcheck')).toBe('true');
  });
});
