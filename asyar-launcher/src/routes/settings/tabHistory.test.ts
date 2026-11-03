import { describe, it, expect } from 'vitest';
import { TabHistory } from './tabHistory.svelte';

describe('TabHistory', () => {
  it('walks back and forward through visited tabs', () => {
    const h = new TabHistory();
    h.visit('general');
    h.visit('about');
    expect(h.canBack).toBe(true);
    expect(h.back()).toBe('general');
    expect(h.canForward).toBe(true);
    expect(h.forward()).toBe('about');
    expect(h.canForward).toBe(false);
  });

  it('ignores repeat visits and drops forward entries on a new visit', () => {
    const h = new TabHistory();
    h.visit('general');
    h.visit('general');
    expect(h.canBack).toBe(false);
    h.visit('about');
    h.back();
    h.visit('privacy');
    expect(h.canForward).toBe(false);
    expect(h.back()).toBe('general');
  });
});
