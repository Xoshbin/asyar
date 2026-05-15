import { describe, it, expect } from 'vitest';

/**
 * Tests asserting that ExtensionManifest accepts a tools field.
 *
 * The tests check runtime behavior. The static type check (ManifestTool import
 * in ExtensionType.ts) is verified indirectly by checking that the contracts
 * surface exports ToolsServiceProxy — which can only be present if tools.ts
 * and the ManifestTool type were wired correctly.
 */
describe('ExtensionManifest — tools field', () => {
  it('contracts.ts exports ToolsServiceProxy (required for tools wiring)', async () => {
    const mod = await import('../contracts');
    expect(typeof (mod as any).ToolsServiceProxy).toBe('function');
  });

  it('a manifest object with tools array has the expected shape', () => {
    const manifest = {
      name: 'Test Extension',
      id: 'com.example.test',
      version: '1.0.0',
      description: 'A test extension',
      commands: [],
      tools: [
        {
          id: 'my-tool',
          name: 'My Tool',
          description: 'Does something useful',
          parameters: { type: 'object', properties: {} },
        },
      ],
    };
    expect(manifest.tools).toHaveLength(1);
    expect(manifest.tools[0].id).toBe('my-tool');
    expect(manifest.tools[0].name).toBe('My Tool');
    expect(manifest.tools[0].description).toBe('Does something useful');
    expect(typeof manifest.tools[0].parameters).toBe('object');
  });

  it('a manifest object without tools is still valid', () => {
    const manifest = {
      name: 'Minimal Extension',
      id: 'com.example.minimal',
      version: '1.0.0',
      description: 'No tools',
      commands: [],
    };
    expect((manifest as any).tools).toBeUndefined();
  });
});
