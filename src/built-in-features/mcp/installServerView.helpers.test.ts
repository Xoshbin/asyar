import { describe, it, expect } from 'vitest';
import {
  validateInstallForm,
  buildInstallInput,
} from './installServerView.helpers';
import type { InstallFormState } from './installServerView.helpers';

function makeStdioForm(over: Partial<InstallFormState> = {}): InstallFormState {
  return {
    id: 'my-server',
    displayName: 'My Server',
    description: '',
    transportKind: 'stdio',
    command: 'npx',
    args: ['my-mcp'],
    env: [{ key: 'API_KEY', value: 'secret' }],
    cwd: '/tmp',
    url: '',
    headers: [],
    ...over,
  };
}

function makeHttpForm(over: Partial<InstallFormState> = {}): InstallFormState {
  return {
    id: 'http-server',
    displayName: 'HTTP Server',
    description: 'An HTTP server',
    transportKind: 'http',
    command: '',
    args: [],
    env: [],
    cwd: '',
    url: 'https://example.com/mcp',
    headers: [{ key: 'Authorization', value: 'Bearer token' }],
    ...over,
  };
}

describe('validateInstallForm', () => {
  it('rejects empty id', () => {
    const result = validateInstallForm(makeStdioForm({ id: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it('rejects empty stdio command', () => {
    const result = validateInstallForm(makeStdioForm({ command: '' }));
    expect(result.ok).toBe(false);
  });

  it('rejects http url that is not valid', () => {
    const result = validateInstallForm(makeHttpForm({ url: 'not-a-url' }));
    expect(result.ok).toBe(false);
  });

  it('accepts valid stdio with empty args/env', () => {
    const result = validateInstallForm(makeStdioForm({ args: [], env: [] }));
    expect(result.ok).toBe(true);
  });

  it('accepts valid http form', () => {
    const result = validateInstallForm(makeHttpForm());
    expect(result.ok).toBe(true);
  });

  it('rejects empty displayName', () => {
    const result = validateInstallForm(makeStdioForm({ displayName: '' }));
    expect(result.ok).toBe(false);
  });
});

describe('buildInstallInput', () => {
  it('from stdio form drops blank env rows', () => {
    const form = makeStdioForm({
      env: [{ key: '', value: 'orphan' }, { key: 'KEY', value: 'val' }],
    });
    const input = buildInstallInput(form);
    if (input.transport.kind !== 'stdio') throw new Error('expected stdio');
    expect(input.transport.env).toEqual({ KEY: 'val' });
  });

  it('from http form preserves headers', () => {
    const form = makeHttpForm({
      headers: [{ key: 'X-Custom', value: 'hello' }],
    });
    const input = buildInstallInput(form);
    if (input.transport.kind !== 'http') throw new Error('expected http');
    expect(input.transport.headers).toEqual({ 'X-Custom': 'hello' });
  });

  it('from stdio form filters blank args', () => {
    const form = makeStdioForm({ args: ['good', '', 'also-good'] });
    const input = buildInstallInput(form);
    if (input.transport.kind !== 'stdio') throw new Error('expected stdio');
    expect(input.transport.args).toEqual(['good', 'also-good']);
  });

  it('sets description to null when empty', () => {
    const form = makeStdioForm({ description: '' });
    const input = buildInstallInput(form);
    expect(input.description).toBeNull();
  });

  it('cwd becomes null when empty string', () => {
    const form = makeStdioForm({ cwd: '' });
    const input = buildInstallInput(form);
    if (input.transport.kind !== 'stdio') throw new Error('expected stdio');
    expect(input.transport.cwd).toBeNull();
  });

  it('output displayName is camelCase in McpServerInstallInput', () => {
    const form = makeStdioForm({ displayName: 'My Server' });
    const input = buildInstallInput(form);
    expect(input.displayName).toBe('My Server');
  });
});
