import { describe, it, expect } from 'vitest';
import { scanForSecret } from './secretGuard';

describe('scanForSecret', () => {
  const files = [
    { path: 'src/worker.ts', content: 'const url = "https://api.notion.com";' },
    { path: 'manifest.json', content: '{"preferences":[{"name":"apiKey","type":"password"}]}' },
  ];

  it('passes when the secret is absent', () => {
    expect(scanForSecret(files, 'secret-ABC-123')).toEqual({ leaked: false });
  });

  it('fails closed when the secret appears verbatim in any file', () => {
    const leaky = [...files, { path: 'src/config.ts', content: 'KEY="secret-ABC-123"' }];
    expect(scanForSecret(leaky, 'secret-ABC-123')).toEqual({ leaked: true, path: 'src/config.ts' });
  });

  it('treats an empty or whitespace secret as nothing to scan (no false positive)', () => {
    expect(scanForSecret(files, '')).toEqual({ leaked: false });
    expect(scanForSecret(files, '   ')).toEqual({ leaked: false });
  });
});
