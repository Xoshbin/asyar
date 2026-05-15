import { describe, it, expect } from 'vitest';
import { NAMESPACES } from './namespaces';

describe('NAMESPACES — tools namespace', () => {
  it('includes tools namespace', () => {
    expect(NAMESPACES).toContain('tools');
  });
});
