import { describe, it, expect, vi } from 'vitest';

vi.mock('./log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { envService, SUPPORTED_SDK_VERSION } from './envService';

describe('storeApiBaseUrl', () => {
  it('returns the production URL', () => {
    expect(envService.storeApiBaseUrl).toBe('https://asyar.org');
  });
});

describe('supportedSdkVersion', () => {
  // Deliberately not a hard-coded version literal. The release scripts rewrite
  // SUPPORTED_SDK_VERSION but cannot rewrite an assertion, so a literal here
  // fails CI on the release branch of every SDK bump. These two tests cover the
  // same ground without that: the getter returns the constant, and the constant
  // tracks the SDK actually in the workspace.
  it('exposes the exported constant', () => {
    expect(envService.supportedSdkVersion).toBe(SUPPORTED_SDK_VERSION);
  });

  it('matches the version in asyar-sdk/package.json', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const sdkPkgPath = resolve(__dirname, '../../../asyar-sdk/package.json');
    const sdkPkg = JSON.parse(readFileSync(sdkPkgPath, 'utf8'));
    expect(envService.supportedSdkVersion).toBe(sdkPkg.version);
  });
});
