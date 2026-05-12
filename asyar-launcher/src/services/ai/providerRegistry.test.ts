import { describe, it, expect, beforeEach } from 'vitest';
import type { IProviderPlugin } from './IProviderPlugin';
import { registerProvider, getProvider, _clearRegistryForTesting } from './providerRegistry';

// A minimal IProviderPlugin-compatible stub used as the starting point.
// Each test mutates it to omit one required field.
function makeBaseStub(id: string): IProviderPlugin {
  return {
    id: id as any,
    name: `Stub-${id}`,
    requiresApiKey: false,
    requiresBaseUrl: false,
    supportsTools: true,
    getModels: async () => [],
    buildRequest: () => ({ url: '', headers: {}, body: '' } as any),
    parseStream: (async function* () {})() as any,
    buildToolRequest: () => ({ url: '', headers: {}, body: '' } as any),
    parseToolStream: (async function* () {}) as any,
  };
}

describe('providerRegistry runtime guard', () => {
  beforeEach(() => {
    _clearRegistryForTesting();
  });

  it('registerProvider_throws_when_buildToolRequest_missing', () => {
    const stub = makeBaseStub('openai-test-missing-build');
    delete (stub as any).buildToolRequest;
    expect(() => registerProvider(stub)).toThrow(/buildToolRequest/);
  });

  it('registerProvider_throws_when_parseToolStream_missing', () => {
    const stub = makeBaseStub('openai-test-missing-parse');
    delete (stub as any).parseToolStream;
    expect(() => registerProvider(stub)).toThrow(/parseToolStream/);
  });

  it('registerProvider_throws_when_supportsTools_not_true', () => {
    const stub = makeBaseStub('openai-test-supports-false');
    (stub as any).supportsTools = false;
    expect(() => registerProvider(stub)).toThrow(/supportsTools/);
  });

  it('registerProvider_succeeds_for_fully_implemented_plugin', () => {
    const stub = makeBaseStub('openai-test-fully-impl');
    expect(() => registerProvider(stub)).not.toThrow();
    expect(getProvider(stub.id)).toBe(stub);
  });
});
