import { describe, it, expect, vi } from 'vitest';

vi.mock('./log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { envService } from './envService';

describe('storeApiBaseUrl', () => {
  it('returns the production URL', () => {
    expect(envService.storeApiBaseUrl).toBe('https://asyar.org');
  });
});

describe('supportedSdkVersion', () => {
  it('returns the current supported SDK version', () => {
    expect(envService.supportedSdkVersion).toBe('4.13.0');
  });

  it('matches the version in asyar-sdk/package.json', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const sdkPkgPath = resolve(__dirname, '../../../asyar-sdk/package.json');
    const sdkPkg = JSON.parse(readFileSync(sdkPkgPath, 'utf8'));
    expect(envService.supportedSdkVersion).toBe(sdkPkg.version);
  });
});
