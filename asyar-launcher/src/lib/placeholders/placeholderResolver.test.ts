import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveTemplate,
  hasPlaceholders,
  fetchPlaceholders,
  type PlaceholderDefinition,
} from './placeholderResolver';

const mockPlaceholders: PlaceholderDefinition[] = [
  { id: 'query', label: 'Search Query', token: 'query' },
  { id: 'trigger', label: 'Agent Trigger', token: 'trigger' },
];

vi.mock('../ipc/invokeSafe', () => ({
  invokeSafe: vi.fn(async (cmd: string) => {
    if (cmd === 'get_available_placeholders') return mockPlaceholders;
    if (cmd === 'resolve_template') return 'resolved_mock';
    return null;
  }),
}));

import { invokeSafe } from '../ipc/invokeSafe';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('placeholderResolver', () => {
  it('calls resolve_template in rust', async () => {
    const res = await resolveTemplate('{query}', { query: 'test' });
    expect(res).toBe('resolved_mock');
    expect(invokeSafe).toHaveBeenCalledWith('resolve_template', expect.any(Object), {
      silent: true,
    });
  });

  it('hasPlaceholders returns true when template contains a known placeholder', async () => {
    expect(await hasPlaceholders('https://google.com/search?q={query}')).toBe(true);
  });

  it('hasPlaceholders returns false when template has no placeholders', async () => {
    expect(await hasPlaceholders('https://example.com')).toBe(false);
  });
});
