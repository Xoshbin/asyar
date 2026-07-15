import { describe, expect, it } from 'vitest';

import { toggleToolSelection } from './agentEditView.helpers';

describe('toggleToolSelection', () => {
  it('adds an absent tool without mutating the displayed selection', () => {
    const selected = ['builtin:echo'];

    const result = toggleToolSelection(selected, 'ext-a:search');

    expect(result).not.toBe(selected);
    expect(result).toContain('ext-a:search');
    expect(selected).not.toContain('ext-a:search');
  });

  it('removes a selected tool', () => {
    const selected = ['builtin:echo', 'ext-a:search'];

    const result = toggleToolSelection(selected, 'builtin:echo');

    expect(result).not.toContain('builtin:echo');
    expect(result).toContain('ext-a:search');
  });
});
