import { describe, it, expect } from 'vitest';
import { SearchEngine } from './SearchEngine';

interface TestItem {
  id: string;
  text: string;
}

function makeEngine(items: TestItem[], mode: 'exact' | 'fuzzy' = 'fuzzy') {
  const engine = new SearchEngine<TestItem>({
    getText: (item) => item.text,
    mode,
  });
  engine.setItems(items);
  return engine;
}

const sampleItems: TestItem[] = [
  { id: '1', text: 'quarterly report summary for Q3' },
  { id: '2', text: 'banana smoothie recipe' },
  { id: '3', text: 'record of transactions' },
  { id: '4', text: 'apple pie recipe' },
  { id: '5', text: 'unrelated text document' },
];

describe('SearchEngine', () => {
  describe('basic behavior', () => {
    it('returns all items when query is empty', () => {
      const engine = makeEngine(sampleItems);
      expect(engine.search('')).toHaveLength(5);
    });

    it('returns all items when query is whitespace', () => {
      const engine = makeEngine(sampleItems);
      expect(engine.search('   ')).toHaveLength(5);
    });

    it('returns empty array when nothing matches', () => {
      const engine = makeEngine(sampleItems);
      expect(engine.search('zzzznothing')).toHaveLength(0);
    });

    it('finds exact substring matches', () => {
      const engine = makeEngine(sampleItems);
      const results = engine.search('banana');
      expect(results.some(r => r.id === '2')).toBe(true);
      expect(results.some(r => r.id === '1')).toBe(false);
    });

    it('is case-insensitive', () => {
      const engine = makeEngine(sampleItems);
      const results = engine.search('BANANA');
      expect(results.some(r => r.id === '2')).toBe(true);
    });

    it('handles multi-word queries with AND logic for exact tier', () => {
      const engine = makeEngine(sampleItems);
      const results = engine.search('apple recipe');
      expect(results.some(r => r.id === '4')).toBe(true);
      expect(results.some(r => r.id === '2')).toBe(false); // has "recipe" but not "apple"
    });
  });

  describe('fuzzy mode — subsequence matching', () => {
    it('matches subsequences: "qrtly" finds "quarterly"', () => {
      const engine = makeEngine(sampleItems);
      const results = engine.search('qrtly');
      expect(results.some(r => r.id === '1')).toBe(true);
    });

    it('matches across word boundaries: "qr" finds "quarterly report"', () => {
      const engine = makeEngine(sampleItems);
      const results = engine.search('qr');
      expect(results.some(r => r.id === '1')).toBe(true);
    });

    it('multi-term fuzzy: "qrtly rep" finds "quarterly report summary"', () => {
      const engine = makeEngine(sampleItems);
      const results = engine.search('qrtly rep');
      expect(results.some(r => r.id === '1')).toBe(true);
      expect(results.some(r => r.id === '5')).toBe(false);
    });
  });

  describe('fuzzy mode — typo tolerance', () => {
    it('tolerates single substitution: "recort" finds "record"', () => {
      const engine = makeEngine(sampleItems);
      const results = engine.search('recort');
      expect(results.some(r => r.id === '3')).toBe(true);
    });

    it('tolerates single transposition: "reocrd" finds "record"', () => {
      const engine = makeEngine(sampleItems);
      const results = engine.search('reocrd');
      expect(results.some(r => r.id === '3')).toBe(true);
    });
  });

  describe('ranking', () => {
    it('ranks exact matches higher than fuzzy-only matches', () => {
      const items: TestItem[] = [
        { id: 'fuzzy', text: 'approximate appple thing' },
        { id: 'exact', text: 'apple pie recipe' },
      ];
      const engine = makeEngine(items);
      const results = engine.search('apple');
      expect(results[0].id).toBe('exact');
    });
  });

  describe('exact mode', () => {
    it('does NOT match subsequences in exact mode', () => {
      const engine = makeEngine(sampleItems, 'exact');
      const results = engine.search('qrtly');
      expect(results).toHaveLength(0);
    });

    it('still finds exact substrings in exact mode', () => {
      const engine = makeEngine(sampleItems, 'exact');
      const results = engine.search('banana');
      expect(results.some(r => r.id === '2')).toBe(true);
    });

    it('multi-term AND logic in exact mode', () => {
      const engine = makeEngine(sampleItems, 'exact');
      const results = engine.search('apple recipe');
      expect(results.some(r => r.id === '4')).toBe(true);
      expect(results.some(r => r.id === '2')).toBe(false);
    });
  });

  describe('setItems', () => {
    it('rebuilds haystack when items change', () => {
      const engine = new SearchEngine<TestItem>({
        getText: (item) => item.text,
      });

      engine.setItems([{ id: '1', text: 'first batch' }]);
      expect(engine.search('first')).toHaveLength(1);

      engine.setItems([{ id: '2', text: 'second batch' }]);
      expect(engine.search('first')).toHaveLength(0);
      expect(engine.search('second')).toHaveLength(1);
    });

    it('skips rebuild if same array reference is passed', () => {
      const items = [{ id: '1', text: 'hello' }];
      const engine = new SearchEngine<TestItem>({
        getText: (item) => item.text,
      });
      engine.setItems(items);
      // Mutate the item (bad practice, but tests the reference check)
      items[0].text = 'changed';
      engine.setItems(items); // same reference — should NOT rebuild
      // Haystack should still contain old value
      expect(engine.search('hello')).toHaveLength(1);
      expect(engine.search('changed')).toHaveLength(0);
    });
  });
});
