import { describe, it, expect } from 'vitest';
import { hasIcon } from 'asyar-sdk/contracts';

interface ManifestShape {
  id?: string;
  icon?: string;
  commands?: Array<{ id?: string; icon?: string }>;
  actions?: Array<{ id?: string; icon?: string }>;
}

const manifestModules = import.meta.glob<ManifestShape>('./*/manifest.json', {
  eager: true,
  import: 'default',
});

function collectIconRefs(manifest: ManifestShape, file: string) {
  const refs: Array<{ name: string; where: string }> = [];
  if (manifest.icon)
    refs.push({ name: manifest.icon, where: `${manifest.id ?? file} (extension icon)` });
  for (const cmd of manifest.commands ?? []) {
    if (cmd.icon) refs.push({ name: cmd.icon, where: `${manifest.id}/${cmd.id} (command)` });
  }
  for (const act of manifest.actions ?? []) {
    if (act.icon) refs.push({ name: act.icon, where: `${manifest.id}/${act.id} (action)` });
  }
  return refs;
}

describe('built-in feature manifests — icon resolution contract', () => {
  it('finds at least one built-in manifest to check', () => {
    expect(Object.keys(manifestModules).length).toBeGreaterThan(0);
  });

  for (const [file, manifest] of Object.entries(manifestModules)) {
    const refs = collectIconRefs(manifest, file);
    const iconRefs = refs.filter((r) => r.name.startsWith('icon:'));
    const assetRefs = refs.filter(
      (r) => !r.name.startsWith('icon:') && (r.name.includes('/') || r.name.includes('.')),
    );

    if (iconRefs.length === 0 && assetRefs.length === 0) continue;

    describe(manifest.id ?? file, () => {
      for (const ref of iconRefs) {
        const iconName = ref.name.slice('icon:'.length);
        it(`${ref.where} resolves icon:${iconName}`, () => {
          expect(hasIcon(iconName)).toBe(true);
        });
      }
      for (const ref of assetRefs) {
        it(`${ref.where} declares bundled asset icon ${ref.name}`, () => {
          expect(ref.name).toMatch(/^assets\/.*\.(png|svg)$/);
        });
      }
    });
  }
});
