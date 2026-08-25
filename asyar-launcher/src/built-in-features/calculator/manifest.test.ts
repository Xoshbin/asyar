import { describe, it, expect } from 'vitest';
import manifest from './manifest.json';

describe('calculator manifest', () => {
  it('declares notifications:send (for copy feedback notifications)', () => {
    expect((manifest as any).permissions).toContain('notifications:send');
  });
});
