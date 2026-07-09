import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('child_process', () => {
  const mocked = { exec: vi.fn(), execFile: vi.fn() };
  return { ...mocked, default: mocked };
});

import { execFile } from 'child_process';
import { openBrowser } from './auth';

describe('openBrowser', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform);
  });

  it('uses `open` on macOS with the URL as a plain argument', () => {
    setPlatform('darwin');
    openBrowser('https://asyar.org/auth/github?redirect=http://localhost:7123/callback');
    expect(execFile).toHaveBeenCalledWith('open', [
      'https://asyar.org/auth/github?redirect=http://localhost:7123/callback',
    ]);
  });

  it('uses `xdg-open` on Linux with the URL as a plain argument', () => {
    setPlatform('linux');
    openBrowser('https://github.com/login/device');
    expect(execFile).toHaveBeenCalledWith('xdg-open', ['https://github.com/login/device']);
  });

  it('uses cmd `start` with an empty-title placeholder on Windows', () => {
    setPlatform('win32');
    openBrowser('https://github.com/login/device');
    expect(execFile).toHaveBeenCalledWith(
      'cmd',
      ['/c', 'start', '""', '"https://github.com/login/device"'],
      { windowsVerbatimArguments: true },
    );
  });

  it('refuses non-http(s) URLs', () => {
    setPlatform('darwin');
    openBrowser('file:///etc/passwd');
    openBrowser('javascript:alert(1)');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('refuses strings that are not URLs at all', () => {
    setPlatform('darwin');
    openBrowser('not a url; rm -rf /');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('passes the normalized URL, percent-encoding shell-hostile characters', () => {
    setPlatform('linux');
    openBrowser('https://example.com/a"b`c');
    const [, args] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[]];
    expect(args[0]).toBe('https://example.com/a%22b%60c');
  });
});
