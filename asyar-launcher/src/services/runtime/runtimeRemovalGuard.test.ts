import { describe, it, expect } from 'vitest';
import { describeRuntimeRemovalWarning } from './runtimeRemovalGuard';

describe('describeRuntimeRemovalWarning', () => {
  it('returns null when there are no consumers', () => {
    expect(describeRuntimeRemovalWarning([])).toBeNull();
  });

  it('uses singular wording and names the one consumer for a single consumer', () => {
    const message = describeRuntimeRemovalWarning(['mcp:my-server']);
    expect(message).toContain('1');
    expect(message).toContain('mcp:my-server');
  });

  it('uses plural wording and names every consumer for multiple consumers', () => {
    const message = describeRuntimeRemovalWarning(['mcp:server-a', 'builtin:ext-builder']);
    expect(message).toContain('2');
    expect(message).toContain('mcp:server-a');
    expect(message).toContain('builtin:ext-builder');
  });
});
