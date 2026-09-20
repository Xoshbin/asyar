import { describe, it, expect } from 'vitest';
import { adaptRaycastPackageJson } from './index';

describe('Raycast Manifest Adapter', () => {
  const sampleRaycastPkg = {
    name: 'github-tools',
    title: 'GitHub Tools',
    description: 'Search repos and issues',
    version: '1.2.0',
    author: 'developer',
    icon: 'icon.png',
    categories: ['Developer Tools'],
    commands: [
      {
        name: 'search-repos',
        title: 'Search Repositories',
        description: 'Find your repositories on GitHub',
        mode: 'view',
      },
      {
        name: 'star-repo',
        title: 'Star Active Repo',
        description: 'Background star action',
        mode: 'no-view',
      },
    ],
    preferences: [
      {
        name: 'token',
        title: 'GitHub Token',
        type: 'password',
        required: true,
        description: 'Personal Access Token',
      },
      {
        name: 'includeForks',
        title: 'Include Forks',
        type: 'checkbox',
        default: false,
      },
      {
        name: 'sortOrder',
        title: 'Sort Order',
        type: 'dropdown',
        default: 'stars',
        data: [
          { title: 'Stars', value: 'stars' },
          { title: 'Updated', value: 'updated' },
        ],
      },
    ],
  };

  it('translates package metadata and IDs', () => {
    const asyarManifest = adaptRaycastPackageJson(sampleRaycastPkg);

    expect(asyarManifest.id).toBe('org.asyar.raycast.github-tools');
    expect(asyarManifest.name).toBe('GitHub Tools');
    expect(asyarManifest.description).toBe('Search repos and issues');
    expect(asyarManifest.version).toBe('1.2.0');
    expect(asyarManifest.author).toBe('developer');
    expect(asyarManifest.type).toBe('extension');
    expect(asyarManifest.background?.main).toBe('dist/worker.js');
  });

  it('maps view and no-view commands correctly', () => {
    const asyarManifest = adaptRaycastPackageJson(sampleRaycastPkg);

    expect(asyarManifest.commands).toHaveLength(2);

    const viewCmd = asyarManifest.commands.find((c) => c.id === 'search-repos');
    expect(viewCmd).toBeDefined();
    expect(viewCmd?.mode).toBe('view');
    expect(viewCmd?.name).toBe('Search Repositories');

    const workerCmd = asyarManifest.commands.find((c) => c.id === 'star-repo');
    expect(workerCmd).toBeDefined();
    expect(workerCmd?.mode).toBe('background');
    expect(workerCmd?.name).toBe('Star Active Repo');
  });

  it('converts preferences schema including dropdown to select', () => {
    const asyarManifest = adaptRaycastPackageJson(sampleRaycastPkg);

    expect(asyarManifest.preferences).toHaveLength(3);

    const tokenPref = asyarManifest.preferences?.find((p) => p.name === 'token');
    expect(tokenPref?.type).toBe('password');
    expect(tokenPref?.title).toBe('GitHub Token');

    const checkboxPref = asyarManifest.preferences?.find((p) => p.name === 'includeForks');
    expect(checkboxPref?.type).toBe('checkbox');
    expect(checkboxPref?.default).toBe(false);

    const dropdownPref = asyarManifest.preferences?.find((p) => p.name === 'sortOrder');
    expect(dropdownPref?.type).toBe('select');
    expect(dropdownPref?.options).toEqual([
      { title: 'Stars', value: 'stars' },
      { title: 'Updated', value: 'updated' },
    ]);
  });

  it('automatically infers essential permissions for Raycast extensions', () => {
    const asyarManifest = adaptRaycastPackageJson(sampleRaycastPkg);

    expect(asyarManifest.permissions).toContain('clipboard:read');
    expect(asyarManifest.permissions).toContain('clipboard:write');
    expect(asyarManifest.permissions).toContain('storage:read');
    expect(asyarManifest.permissions).toContain('storage:write');
    expect(asyarManifest.permissions).toContain('shell:open-url');
    expect(asyarManifest.permissions).toContain('network');
  });
});
