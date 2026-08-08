import { describe, it, expect } from 'vitest';
import { countUserCreatedPortals } from './portalCounting';

describe('countUserCreatedPortals', () => {
  it('ignores the portals seeded on first run', () => {
    const seeded = [{ id: 'default-search-google' }, { id: 'default-search-github' }];
    expect(countUserCreatedPortals(seeded)).toBe(0);
  });

  it('counts portals the user made', () => {
    expect(countUserCreatedPortals([{ id: 'default-search-google' }, { id: 'abc123' }])).toBe(1);
  });

  it('handles an empty or missing list', () => {
    expect(countUserCreatedPortals([])).toBe(0);
    expect(countUserCreatedPortals(undefined)).toBe(0);
  });

  it('does not choke on a portal with no id', () => {
    expect(countUserCreatedPortals([{ id: undefined as unknown as string }])).toBe(1);
  });
});
