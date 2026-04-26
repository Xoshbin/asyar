import { describe, it, expect } from 'vitest';
import { NAMESPACES } from 'asyar-sdk/contracts';

describe('serviceRegistry anti-reflection guard', () => {
  it('contains no class-name-shaped entries (ends with Service/Manager, or PascalCase)', () => {
    const forbidden = /^[A-Z]|Service$|Manager$/;
    const bad = NAMESPACES.filter((n) => forbidden.test(n));
    expect(bad).toEqual([]);
  });

  it('never regresses: if Namespace gains a PascalCase entry, this test fires', () => {
    for (const n of NAMESPACES) {
      expect(n[0]).toBe(n[0].toLowerCase());
    }
  });
});
