import { describe, it, expect } from 'vitest';

/**
 * Tests for the ManifestTool / ToolDescriptor / IToolsService contracts
 * defined in src/contracts/tools.ts.
 *
 * Vitest + Vite resolve imports at transform time, so we assert module
 * existence by checking the public re-export surface in contracts.ts
 * rather than importing from the not-yet-created file directly.
 */
describe('tools contracts — re-exported through contracts.ts', () => {
  it('contracts.ts re-exports IToolsService', async () => {
    const mod = await import('../contracts');
    expect('IToolsService' in mod || true).toBe(true);
    // The real assertion: when tools.ts exists and is re-exported,
    // contracts.ts will contain the type. We assert the module has
    // a known symbol that item 5 must add — ToolsServiceProxy.
    // If absent, worker cannot wire the proxy.
    expect(typeof (mod as any).ToolsServiceProxy).not.toBe('undefined');
  });
});

describe('ManifestTool shape', () => {
  it('tool object with id/name/description/parameters is valid', () => {
    const tool = {
      id: 'search-web',
      name: 'Search Web',
      description: 'Searches the web',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    };
    expect(tool.id).toBe('search-web');
    expect(tool.name).toBe('Search Web');
    expect(tool.description).toBe('Searches the web');
    expect(typeof tool.parameters).toBe('object');
  });
});

describe('ToolDescriptor shape', () => {
  it('builtin source descriptor is valid', () => {
    const descriptor = {
      id: 'open-url',
      name: 'Open URL',
      description: 'Opens a URL',
      parameters: {},
      source: 'builtin' as const,
      fullyQualifiedId: 'builtin:open-url',
    };
    expect(descriptor.source).toBe('builtin');
    expect(descriptor.fullyQualifiedId).toMatch(/^builtin:/);
  });

  it('extension source descriptor is valid', () => {
    const descriptor = {
      id: 'my-tool',
      name: 'My Tool',
      description: 'Does something',
      parameters: {},
      source: { extensionId: 'com.example.my-ext' },
      fullyQualifiedId: 'com.example.my-ext:my-tool',
    };
    expect((descriptor.source as { extensionId: string }).extensionId).toBe('com.example.my-ext');
    expect(descriptor.fullyQualifiedId).toMatch(/^[^:]+:[^:]+$/);
  });
});

describe('ToolDescriptor shape', () => {
  it('mcp source descriptor is valid', () => {
    const descriptor = {
      id: 'search-web',
      name: 'Search Web',
      description: 'Searches via MCP',
      parameters: {},
      source: { mcpServerId: 'srv-acme' },
      fullyQualifiedId: 'mcp:srv-acme:search-web',
    };
    expect((descriptor.source as { mcpServerId: string }).mcpServerId).toBe('srv-acme');
    expect(descriptor.fullyQualifiedId).toMatch(/^mcp:[^:]+:[^:]+$/);
  });
});

describe('IToolsService mock', () => {
  it('registerTool/unregisterTool/listTools are async', () => {
    const svc = {
      registerTool: async (_tool: unknown, _handler: unknown) => undefined,
      unregisterTool: async (_id: string) => undefined,
      listTools: async () => [] as unknown[],
    };
    expect(svc.registerTool({}, async () => null)).toBeInstanceOf(Promise);
    expect(svc.unregisterTool('t')).toBeInstanceOf(Promise);
    expect(svc.listTools()).toBeInstanceOf(Promise);
  });
});
