import { describe, it, expect } from 'vitest';
import { canRunAsAdmin, hasAppFilePath, isStoreAppPath } from './appLocation';

const STORE = 'shell:AppsFolder\\Microsoft.Foo_8wekyb3d8bbwe!App';

describe('hasAppFilePath', () => {
  it('accepts real paths on every platform', () => {
    expect(hasAppFilePath('/Applications/Zoom.app')).toBe(true);
    expect(hasAppFilePath('C:\\Users\\a\\Zoom.lnk')).toBe(true);
    expect(hasAppFilePath('/usr/share/applications/zoom.desktop')).toBe(true);
  });

  it('rejects missing paths and Microsoft Store apps', () => {
    expect(hasAppFilePath(undefined)).toBe(false);
    expect(hasAppFilePath('')).toBe(false);
    expect(hasAppFilePath(STORE)).toBe(false);
    expect(isStoreAppPath(STORE)).toBe(true);
  });
});

describe('canRunAsAdmin', () => {
  it('is offered for .lnk and .exe on Windows only', () => {
    expect(canRunAsAdmin('C:\\Start Menu\\Zoom.lnk', 'windows')).toBe(true);
    expect(canRunAsAdmin('C:\\Zoom\\zoom.EXE', 'windows')).toBe(true);
    expect(canRunAsAdmin('/Applications/Zoom.app', 'macos')).toBe(false);
    expect(canRunAsAdmin('/usr/share/applications/zoom.desktop', 'other')).toBe(false);
    expect(canRunAsAdmin('C:\\Start Menu\\Zoom.lnk', 'macos')).toBe(false);
  });

  it('is hidden on Windows for Store apps, scripts and missing paths', () => {
    expect(canRunAsAdmin(STORE, 'windows')).toBe(false);
    expect(canRunAsAdmin('C:\\run.bat', 'windows')).toBe(false);
    expect(canRunAsAdmin(undefined, 'windows')).toBe(false);
  });
});
