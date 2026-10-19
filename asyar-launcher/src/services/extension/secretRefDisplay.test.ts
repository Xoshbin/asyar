import { describe, expect, it } from 'vitest';
import { describeSecretRefs } from './secretRefDisplay';

const reference = {
  name: 'cli-token',
  sources: [
    { type: 'jsonFile', path: '~/.somecli/.credentials.json', pointer: '/oauth/accessToken' },
    {
      type: 'keychain',
      service: 'Some-CLI-credentials',
      account: null,
      pointer: '/oauth/accessToken',
    },
  ],
  hosts: ['api.example.com'],
  methods: ['GET'],
  pathPrefixes: ['/api/usage'],
  header: 'Authorization',
  template: 'Bearer {secret}',
};

describe('describeSecretRefs', () => {
  it('describes_keychain_only_and_unrestricted_paths', () => {
    expect(
      describeSecretRefs([
        {
          ...reference,
          sources: [
            { type: 'keychain', service: 'Generic login', account: 'user', pointer: '/token' },
          ],
          methods: undefined,
          pathPrefixes: undefined,
        },
      ])[0],
    ).toBe(
      'Sends the secret in the Keychain item “Generic login” (account “user”) at `/token` to api.example.com — GET (all paths) — as the Authorization header. macOS may ask you to allow Asyar to read this Keychain item.',
    );
  });
  it('renders_source_hosts_methods_and_keychain_note', () => {
    expect(describeSecretRefs([reference])).toEqual([
      'Sends the secret at `/oauth/accessToken` in `~/.somecli/.credentials.json` (or the Keychain item “Some-CLI-credentials” at `/oauth/accessToken`) to api.example.com — GET /api/usage — as the Authorization header. macOS may ask you to allow Asyar to read this Keychain item.',
    ]);
  });
  it('shows_punycode_hosts', () => {
    expect(
      describeSecretRefs([
        { ...reference, hosts: ['xn--bcher-kva.example:443'], methods: undefined },
      ])[0],
    ).toContain('xn--bcher-kva.example:443 — GET');
  });
  it('never_throws_on_malformed_args', () => {
    for (const args of [
      undefined,
      null,
      42,
      'bad',
      {},
      [null, {}, { sources: [null], hosts: 3 }],
    ]) {
      expect(() => describeSecretRefs(args)).not.toThrow();
      expect(describeSecretRefs(args)).toEqual([]);
    }
    const cyclic: any = {};
    cyclic.sources = [cyclic];
    expect(() => describeSecretRefs([cyclic])).not.toThrow();
  });
});
