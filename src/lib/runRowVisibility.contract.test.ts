import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/extension/extensionManager.svelte', () => ({
  __esModule: true,
  default: {
    getManifestById: vi.fn(),
    handleCommandAction: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/application/applicationsService', () => ({
  applicationService: { open: vi.fn() },
}));

vi.mock('../services/run/runService.svelte', () => ({
  runService: { selectedRunId: null, active: [], recent: [] },
}));

vi.mock('../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}));

vi.mock('../built-in-features/agents/agentsManager.svelte', () => ({
  agentsManager: { currentAgentId: null, currentThreadId: null },
}));

vi.mock('../built-in-features/agents/agentService.svelte', () => ({
  agentService: { agents: [] as Array<{ id: string; name: string }> },
}));

vi.mock('../built-in-features/scripts/scriptsManager.svelte', () => ({
  scriptsManager: {
    getScriptByDynamicId: vi.fn(),
  },
}));

vi.mock('./ipc/commands', () => ({
  agentsFindRunOrigin: vi.fn().mockResolvedValue(null),
}));

import { buildMappedItems } from './searchResultMapper';
import { buildSectionedView, categorizeItem } from '../components/list/sectionedListLogic';
import type { RunSnapshot } from '../services/launcher/itemStatusLogic';
import type { SearchResult } from '../services/search/interfaces/SearchResult';
import type { Run } from 'asyar-sdk/contracts';

function makeResult(over: Partial<SearchResult> = {}): SearchResult {
  return {
    objectId: 'test-id',
    name: 'Test',
    type: 'command',
    score: 0.5,
    ...over,
  } as SearchResult;
}

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 'r1',
    kind: 'agent',
    label: 'agent run',
    status: 'running',
    startedAt: Date.now(),
    cancellable: true,
    ...over,
  };
}

// Plain-English contract: a definition row and an attributed run row are the
// SAME thing shown twice. When a run's `subjectId` matches a definition row's
// objectId, the definition row carries the status signal (statusForRow →
// computeItemStatus) and the standalone run row is suppressed — otherwise the
// list shows the same work twice and keyboard nav double-counts it. Anonymous
// runs (no subjectId match) keep their own row.

describe('contract: attributed run rows collapse into their definition row', () => {
  describe('agents', () => {
    it('an active agent run with a matching def row: only the def row renders', () => {
      const run = makeRun({
        id: 'r-agent-active',
        kind: 'agent',
        label: 'Grammar Fix',
        status: 'running',
        subjectId: 'cmd_agents_dyn_grammar',
      });
      const defRow = makeResult({
        objectId: 'cmd_agents_dyn_grammar',
        name: 'Grammar Fix',
        type: 'command',
      });

      const { mappedItems } = buildMappedItems({
        searchItems: [defRow],
        activeContext: null,
        shortcutStore: [],
        localSearchValue: '',
        selectedIndex: 0,
        onError: vi.fn(),
        activeRuns: [run],
        query: '',
      });

      const ids = mappedItems.map((m) => m.object_id);
      expect(ids).toContain('cmd_agents_dyn_grammar');
      expect(ids).not.toContain('run_r-agent-active');
    });

    it('an anonymous agent run (no matching def row) keeps its own run row', () => {
      const run = makeRun({
        id: 'r-agent-anon',
        kind: 'agent',
        label: 'Ad-hoc',
        status: 'running',
        subjectId: 'cmd_agents_dyn_absent',
      });

      const { mappedItems } = buildMappedItems({
        searchItems: [],
        activeContext: null,
        shortcutStore: [],
        localSearchValue: '',
        selectedIndex: 0,
        onError: vi.fn(),
        activeRuns: [run],
        query: '',
      });

      const ids = mappedItems.map((m) => m.object_id);
      // No def row in baseItems and the dynamic id is unknown to the registry,
      // so the run surfaces as its own row rather than being reified away.
      expect(ids).toContain('run_r-agent-anon');
    });
  });

  describe('scripts', () => {
    it('an active script run with a matching def row: only the def row renders', () => {
      const run = makeRun({
        id: 'r-script-active',
        kind: 'shell-script',
        label: 'Update Hosts',
        status: 'running',
        subjectId: 'cmd_scripts_dyn_updates',
      });
      const defRow = makeResult({
        objectId: 'cmd_scripts_dyn_updates',
        name: 'updates',
        type: 'command',
      });

      const { mappedItems } = buildMappedItems({
        searchItems: [defRow],
        activeContext: null,
        shortcutStore: [],
        localSearchValue: '',
        selectedIndex: 0,
        onError: vi.fn(),
        activeRuns: [run],
        query: '',
      });

      const ids = mappedItems.map((m) => m.object_id);
      expect(ids).toContain('cmd_scripts_dyn_updates');
      expect(ids).not.toContain('run_r-script-active');
    });

    it('a kept-success script result with a matching def row: only the def row renders', () => {
      const result = makeRun({
        id: 'r-script-done',
        kind: 'shell-script',
        label: 'Hosts Update',
        status: 'succeeded',
        subjectId: 'cmd_scripts_dyn_hosts',
        tailOutput: 'OK',
        endedAt: Date.now(),
      });
      const defRow = makeResult({
        objectId: 'cmd_scripts_dyn_hosts',
        name: 'hosts',
        type: 'command',
      });

      const { mappedItems } = buildMappedItems({
        searchItems: [defRow],
        activeContext: null,
        shortcutStore: [],
        localSearchValue: '',
        selectedIndex: 0,
        onError: vi.fn(),
        scriptResultRuns: [result],
        query: '',
      });

      const ids = mappedItems.map((m) => m.object_id);
      expect(ids).toContain('cmd_scripts_dyn_hosts');
      expect(ids).not.toContain('run_r-script-done');
    });
  });
});

// Plain-English contract: status sections are Failed → Done → Active →
// Commands. A script definition row CLIMBS into a status section based on its
// effective run status — a running script's def row sits under Active, not
// under Commands with a dot. Agent definition rows never climb (their kept
// thread row carries the signal). This is the inverse of an earlier model
// where def rows always stayed in Commands.

describe('contract: script def rows climb into status sections', () => {
  function snap(over: Partial<RunSnapshot> = {}): RunSnapshot {
    return {
      id: 'r1',
      kind: 'shell-script',
      status: 'running',
      startedAt: Date.now(),
      ...over,
    } as RunSnapshot;
  }

  it('an idle script def row stays in Commands', () => {
    const defItem = { type: 'command', object_id: 'cmd_scripts_dyn_idle' } as any;
    expect(categorizeItem(defItem, [], [], [])).toBe('commands');
  });

  it('a script def row with a live run climbs into Active', () => {
    const defItem = { type: 'command', object_id: 'cmd_scripts_dyn_updates' } as any;
    const active = [snap({ id: 'r-live', subjectId: 'cmd_scripts_dyn_updates', status: 'running' })];
    expect(categorizeItem(defItem, active, [], [])).toBe('active');
  });

  it('a script def row with a kept-success result climbs into Done', () => {
    const defItem = { type: 'command', object_id: 'cmd_scripts_dyn_hosts' } as any;
    const succeeded = [snap({ id: 'r-done', subjectId: 'cmd_scripts_dyn_hosts', status: 'succeeded', endedAt: Date.now() })];
    expect(categorizeItem(defItem, [], [], succeeded)).toBe('done');
  });

  it('a script def row with an unacknowledged failure climbs into Failed', () => {
    const defItem = { type: 'command', object_id: 'cmd_scripts_dyn_broken' } as any;
    const failed = [snap({ id: 'r-failed', subjectId: 'cmd_scripts_dyn_broken', status: 'failed', endedAt: Date.now() })];
    expect(categorizeItem(defItem, [], failed, [])).toBe('failed');
  });

  it('an agent def row never climbs — it stays in Commands even with a matching live run', () => {
    const defItem = { type: 'command', object_id: 'cmd_agents_dyn_grammar' } as any;
    const active = [snap({ id: 'r-a', kind: 'agent', subjectId: 'cmd_agents_dyn_grammar', status: 'running' })];
    expect(categorizeItem(defItem, active, [], [])).toBe('commands');
  });

  it('end-to-end: a live script def row surfaces under Active in the sectioned view', () => {
    const run = makeRun({
      id: 'r-live',
      kind: 'shell-script',
      label: 'Updates',
      status: 'running',
      subjectId: 'cmd_scripts_dyn_updates',
    });
    const defRow = makeResult({
      objectId: 'cmd_scripts_dyn_updates',
      name: 'updates',
      type: 'command',
    });

    const { mappedItems } = buildMappedItems({
      searchItems: [defRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [run],
      query: '',
    });

    const rows = buildSectionedView(mappedItems, [
      { id: 'r-live', kind: 'shell-script', status: 'running', startedAt: Date.now(), subjectId: 'cmd_scripts_dyn_updates' } as RunSnapshot,
    ], [], []);

    const activeIds: string[] = [];
    let bucket: string | null = null;
    for (const r of rows) {
      if (r.kind === 'header') {
        bucket = r.section;
        continue;
      }
      if (bucket === 'active') activeIds.push(r.item.object_id);
    }

    expect(activeIds).toContain('cmd_scripts_dyn_updates');
  });
});
