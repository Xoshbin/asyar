import { describe, it, expect } from 'vitest';
import manifest from './manifest.json';
describe('create-extension manifest', () => {
  it('declares notifications:send (the AI builder sends notifications as create-extension)', () => {
    expect(manifest.permissions).toContain('notifications:send');
  });
});
