import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockList = vi.hoisted(() => vi.fn());
const mockReport = vi.hoisted(() => vi.fn());

vi.mock('./createdExtensions', () => ({ listCreatedExtensions: mockList }));
vi.mock('../../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: mockReport },
}));

import { createdExtensionsViewState } from './createdExtensionsViewState.svelte';

const ITEMS = [
  { id: 'com.a.alpha', name: 'Alpha', version: '1.0.0', description: 'first', path: '/x/alpha' },
  { id: 'com.a.bravo', name: 'Bravo', version: '1.0.0', description: 'second tool', path: '/x/bravo' },
];

beforeEach(() => { createdExtensionsViewState.reset(); mockList.mockReset(); mockReport.mockReset(); });

describe('createdExtensionsViewState', () => {
  it('load() populates items from listCreatedExtensions', async () => {
    mockList.mockResolvedValue(ITEMS);
    await createdExtensionsViewState.load();
    expect(createdExtensionsViewState.items).toEqual(ITEMS);
  });

  it('filtered() matches on name / id / description; empty query → all', async () => {
    mockList.mockResolvedValue(ITEMS);
    await createdExtensionsViewState.load();
    expect(createdExtensionsViewState.filtered()).toEqual(ITEMS);
    createdExtensionsViewState.setSearch('bravo');
    expect(createdExtensionsViewState.filtered().map((i) => i.id)).toEqual(['com.a.bravo']);
    createdExtensionsViewState.setSearch('second');
    expect(createdExtensionsViewState.filtered().map((i) => i.id)).toEqual(['com.a.bravo']);
    createdExtensionsViewState.setSearch('com.a.alpha');
    expect(createdExtensionsViewState.filtered().map((i) => i.id)).toEqual(['com.a.alpha']);
  });

  it('load() error → items stays [] and a diagnostic is reported', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    await createdExtensionsViewState.load();
    expect(createdExtensionsViewState.items).toEqual([]);
    expect(mockReport).toHaveBeenCalled();
  });

  it('selectedItem tracks the filtered selection', async () => {
    mockList.mockResolvedValue(ITEMS);
    await createdExtensionsViewState.load();
    expect(createdExtensionsViewState.selectedItem?.id).toBe('com.a.alpha');
    createdExtensionsViewState.moveSelection('down');
    expect(createdExtensionsViewState.selectedItem?.id).toBe('com.a.bravo');
  });
});
