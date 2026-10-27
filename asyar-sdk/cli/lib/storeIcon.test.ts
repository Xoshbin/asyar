import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { checkStoreIcon, iconFilePath } from './storeIcon';

describe('iconFilePath', () => {
  it('returns the package path of an image file icon', () => {
    expect(iconFilePath('assets/icon.png')).toBe('assets/icon.png');
    expect(iconFilePath('./assets/icon.PNG')).toBe('assets/icon.PNG');
  });

  it('returns null for icons that are not files', () => {
    expect(iconFilePath('⏱️')).toBeNull();
    expect(iconFilePath('icon:timer')).toBeNull();
    expect(iconFilePath(undefined)).toBeNull();
    expect(iconFilePath({ glyph: 'timer' })).toBeNull();
  });
});

describe('checkStoreIcon', () => {
  let packageRoot: string;

  beforeEach(() => {
    packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'asyar-storeIcon-test-'));
    fs.mkdirSync(path.join(packageRoot, 'assets'));
  });

  afterEach(() => {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  });

  it('accepts a PNG icon that is in the package', () => {
    fs.writeFileSync(path.join(packageRoot, 'assets', 'icon.png'), '');
    expect(checkStoreIcon('assets/icon.png', packageRoot)).toEqual({ errors: [], warnings: [] });
  });

  it('fails when the icon file is not in the package', () => {
    const { errors } = checkStoreIcon('assets/icon.png', packageRoot);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('assets/icon.png');
  });

  it('warns, but does not fail, for an SVG icon the Store cannot show', () => {
    fs.writeFileSync(path.join(packageRoot, 'assets', 'icon.svg'), '<svg/>');
    const { errors, warnings } = checkStoreIcon('assets/icon.svg', packageRoot);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('PNG');
  });

  it('has nothing to check for emoji and built-in icons', () => {
    expect(checkStoreIcon('⏱️', packageRoot)).toEqual({ errors: [], warnings: [] });
    expect(checkStoreIcon('icon:timer', packageRoot)).toEqual({ errors: [], warnings: [] });
  });
});
