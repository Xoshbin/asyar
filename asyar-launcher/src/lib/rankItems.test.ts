import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { rankItems, fuzzyMatchScore, MatchTier } from './rankItems';
import { invoke } from '@tauri-apps/api/core';

interface Item {
  id: string;
  name: string;
  desc?: string;
  tags?: string[];
}

const items: Item[] = [
  { id: '1', name: 'Safari', desc: 'web browser', tags: ['apple', 'internet'] },
  { id: '2', name: 'Notes', desc: 'jot things down', tags: ['writing'] },
  { id: '3', name: 'Terminal', desc: 'command line interface', tags: ['shell', 'bash'] },
  { id: '4', name: 'Safe Exam Browser', desc: 'kiosk browser' },
];

describe('rankItems (Zero-IPC Fast Path)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns items unchanged for an empty or whitespace query without calling Tauri IPC', async () => {
    const result = await rankItems('   ', items, {
      id: (i) => i.id,
      title: (i) => i.name,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual(items);
  });

  it('never calls Tauri invoke on any search query (Zero-IPC guarantee)', async () => {
    await rankItems('saf', items, {
      id: (i) => i.id,
      title: (i) => i.name,
      subtitle: (i) => i.desc,
      keywords: (i) => i.tags ?? [],
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('ranks exact title match at the very top (Tier 1)', async () => {
    const testItems: Item[] = [
      { id: '1', name: 'Notes App' },
      { id: '2', name: 'Notes' },
      { id: '3', name: 'My Notes' },
    ];
    const result = await rankItems('notes', testItems, {
      id: (i) => i.id,
      title: (i) => i.name,
    });
    expect(result[0].id).toBe('2'); // Exact match
    expect(result[1].id).toBe('1'); // Prefix match
  });

  it('ranks title prefix match (Tier 2) before fuzzy match (Tier 3)', async () => {
    const testItems: Item[] = [
      { id: 'fuzzy', name: 'Safe and Sound' },
      { id: 'prefix', name: 'Safepoint' },
    ];
    const result = await rankItems('safe', testItems, {
      id: (i) => i.id,
      title: (i) => i.name,
    });
    expect(result.map((i) => i.id)).toEqual(['prefix', 'fuzzy']);
  });

  it('ranks fuzzy matches in title (Tier 3)', async () => {
    const result = await rankItems('sfr', items, {
      id: (i) => i.id,
      title: (i) => i.name,
    });
    // Both 'Safari' and 'Safe Exam Browser' match the subsequence 'sfr',
    // but 'Safari' is shorter and more compact so it ranks first.
    expect(result[0].id).toBe('1');
    expect(result.map((i) => i.id)).toEqual(['1', '4']);
  });

  it('matches and ranks on subtitle and keywords (Tier 4)', async () => {
    const result = await rankItems('shell', items, {
      id: (i) => i.id,
      title: (i) => i.name,
      subtitle: (i) => i.desc,
      keywords: (i) => i.tags ?? [],
    });
    expect(result.map((i) => i.id)).toEqual(['3']); // Terminal has tag 'shell'
  });

  it('drops items that do not match query anywhere', async () => {
    const result = await rankItems('xyznonexistent', items, {
      id: (i) => i.id,
      title: (i) => i.name,
      subtitle: (i) => i.desc,
      keywords: (i) => i.tags ?? [],
    });
    expect(result).toEqual([]);
  });

  it('trims query whitespace and performs case-insensitive matching', async () => {
    const result = await rankItems('  SAFARI  ', items, {
      id: (i) => i.id,
      title: (i) => i.name,
    });
    expect(result.map((i) => i.id)).toEqual(['1']);
  });
});

describe('fuzzyMatchScore', () => {
  it('returns positive score for valid subsequence match', () => {
    const score = fuzzyMatchScore('Safari', 'saf');
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0);
  });

  it('returns null when query is not a subsequence', () => {
    expect(fuzzyMatchScore('Notes', 'xyz')).toBeNull();
  });

  it('awards higher score for consecutive characters', () => {
    const scoreConsecutive = fuzzyMatchScore('Safari', 'saf');
    const scoreScattered = fuzzyMatchScore('Safe and Fair', 'saf');
    expect(scoreConsecutive!).toBeGreaterThan(scoreScattered!);
  });
});
