import { describe, it, expect, beforeEach } from 'vitest';
import { initProviders } from './initProviders';
import { listProviders, _clearRegistryForTesting } from './providerRegistry';

describe('initProviders', () => {
  beforeEach(() => {
    _clearRegistryForTesting();
  });

  it('registers exactly 6 provider plugins', () => {
    initProviders();
    expect(listProviders()).toHaveLength(6);
  });

  it('registers the correct provider ids', () => {
    initProviders();
    const ids = listProviders().map((p) => p.id);
    expect(ids).toContain('openai');
    expect(ids).toContain('anthropic');
    expect(ids).toContain('google');
    expect(ids).toContain('ollama');
    expect(ids).toContain('openrouter');
    expect(ids).toContain('custom');
  });

  it('is idempotent — calling twice still yields exactly 6 plugins', () => {
    initProviders();
    initProviders();
    expect(listProviders()).toHaveLength(6);
  });
});
