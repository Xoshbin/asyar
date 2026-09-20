import { describe, it, expect } from 'vitest';
import { adaptRaycastPackageJson } from './index';

describe('asyar-sdk/compat/raycast manifest adapter export', () => {
  it('adapts package.json to Asyar manifest', () => {
    const manifest = adaptRaycastPackageJson({
      name: 'hello-world',
      title: 'Hello World',
      commands: [{ name: 'say-hi', title: 'Say Hi', mode: 'view' }],
    });

    expect(manifest.id).toBe('org.asyar.raycast.hello-world');
    expect(manifest.name).toBe('Hello World');
    expect(manifest.commands[0].mode).toBe('view');
  });
});
