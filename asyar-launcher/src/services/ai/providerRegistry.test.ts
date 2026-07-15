import { describe, it, expect, beforeEach } from 'vitest';
import type { IProviderPlugin } from './IProviderPlugin';
import { ProviderRegistry } from './providerRegistry';

function makeBaseStub(id: string): IProviderPlugin {
  return {
    id: id as any,
    name: `Stub-${id}`,
    requiresApiKey: false,
    requiresBaseUrl: false,
    getModels: async () => [],
  };
}

describe('providerRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('registers a display-only provider descriptor', () => {
    const stub = makeBaseStub('openai-test-metadata');
    expect(() => registry.register(stub)).not.toThrow();
    expect(registry.get(stub.id)).toBe(stub);
  });
});
