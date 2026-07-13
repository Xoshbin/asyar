import { describe, it, expect, vi } from 'vitest';
import { importServers } from './importServersView.helpers';
import type { McpServerInstallInput, McpServerSummary } from './types';

const makeInput = (id: string): McpServerInstallInput => ({
  id,
  displayName: `Server ${id}`,
  description: null,
  transport: { kind: 'stdio', command: 'bun', args: [], env: {}, cwd: null },
});

const makeSummary = (id: string): McpServerSummary => ({
  id,
  displayName: `Server ${id}`,
  description: null,
  transportKind: 'stdio',
  enabled: true,
  status: 'connected',
  toolsCount: 0,
});

describe('importServers', () => {
  it('reports ok:true for every server that installs successfully', async () => {
    const install = vi.fn(async (input: McpServerInstallInput) => makeSummary(input.id));
    const outcomes = await importServers([makeInput('a'), makeInput('b')], install, () => null);

    expect(outcomes).toEqual([
      { id: 'a', displayName: 'Server a', ok: true },
      { id: 'b', displayName: 'Server b', ok: true },
    ]);
  });

  it('captures the install-service error message for a server that fails', async () => {
    const install = vi.fn().mockResolvedValueOnce(makeSummary('a')).mockResolvedValueOnce(null);
    // Only called for the failed server — the successful one never triggers
    // an error read at all.
    const getLastError = vi
      .fn()
      .mockReturnValue(
        'Could not install this MCP server — check its command/arguments and try again.',
      );

    const outcomes = await importServers([makeInput('a'), makeInput('b')], install, getLastError);
    expect(getLastError).toHaveBeenCalledTimes(1);

    expect(outcomes).toEqual([
      { id: 'a', displayName: 'Server a', ok: true },
      {
        id: 'b',
        displayName: 'Server b',
        ok: false,
        error: 'Could not install this MCP server — check its command/arguments and try again.',
      },
    ]);
  });

  it('falls back to a generic message when the install service reports no specific error', async () => {
    const install = vi.fn().mockResolvedValueOnce(null);
    const outcomes = await importServers([makeInput('a')], install, () => null);

    expect(outcomes).toEqual([
      { id: 'a', displayName: 'Server a', ok: false, error: 'Import failed.' },
    ]);
  });

  it('installs sequentially, one at a time, not concurrently', async () => {
    const order: string[] = [];
    const install = vi.fn(async (input: McpServerInstallInput) => {
      order.push(`start:${input.id}`);
      await Promise.resolve();
      order.push(`end:${input.id}`);
      return makeSummary(input.id);
    });

    await importServers([makeInput('a'), makeInput('b')], install, () => null);

    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });
});
