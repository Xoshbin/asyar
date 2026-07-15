import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initProviders } from './initProviders';
import { providerRegistry } from './providerRegistry';
import { aiListModels } from '../../lib/ipc/commands';

vi.mock('../../lib/ipc/commands', () => ({ aiListModels: vi.fn() }));

describe('initProviders', () => {
  beforeEach(() => {
    providerRegistry.clearForTesting();
    vi.clearAllMocks();
  });

  it('registers exactly 6 provider plugins', () => {
    initProviders();
    expect(providerRegistry.list()).toHaveLength(6);
  });

  it('registers the correct provider ids', () => {
    initProviders();
    const ids = providerRegistry.list().map((p) => p.id);
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
    expect(providerRegistry.list()).toHaveLength(6);
  });

  it('delegates model discovery to Rust', async () => {
    vi.mocked(aiListModels).mockResolvedValue([
      { id: 'rust-model', label: 'Rust model', reasoningEfforts: ['high'] },
    ]);
    initProviders();

    const config = { enabled: true, apiKey: 'secret' };
    const models = await providerRegistry.list()[0].getModels(config);

    expect(aiListModels).toHaveBeenCalledWith('openai', config);
    expect(models).toEqual([{ id: 'rust-model', label: 'Rust model', reasoningEfforts: ['high'] }]);
  });
});
