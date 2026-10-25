import { describe, it, expect } from 'vitest';
import { parseUrl } from './parseUrl';

describe('parseUrl', () => {
  it.each([
    ['https://github.com/Xoshbin/asyar/issues/895', 'https://github.com/Xoshbin/asyar/issues/895'],
    ['HTTP://Example.com', 'HTTP://Example.com'],
    ['  github.com  ', 'https://github.com'],
    ['github.com/Xoshbin/asyar', 'https://github.com/Xoshbin/asyar'],
    ['www.example.org?q=1', 'https://www.example.org?q=1'],
    ['asyar.org#install', 'https://asyar.org#install'],
    ['sub.domain.co.uk', 'https://sub.domain.co.uk'],
    ['localhost', 'http://localhost'],
    ['localhost:5173/settings', 'http://localhost:5173/settings'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['192.168.1.10/admin', 'http://192.168.1.10/admin'],
  ])('accepts %s', (input, expected) => {
    expect(parseUrl(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'safari',
    'settings',
    'index.ts',
    'app.py',
    'main.rs',
    'style.css',
    'Cargo.toml',
    'README.md',
    'Safari.app',
    'lib.so',
    'script.sh',
    'data.zip',
    'logo.pl',
    'bob@example.com',
    'go to github.com',
    'github.com later',
    'mailto:bob@example.com',
    'ftp://example.com',
    'file:///etc/hosts',
    'javascript:alert(1)',
    '/Users/a/project',
    '~/Documents',
    'src/main.rs',
    '999.1.1.1',
    '1.2.3',
    '3.14',
    'https://',
    'http:// example.com',
  ])('rejects %s', (input) => {
    expect(parseUrl(input)).toBeNull();
  });
});
