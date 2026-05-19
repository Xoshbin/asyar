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

vi.mock('./ipc/commands', () => ({
  agentsFindRunOrigin: vi.fn().mockResolvedValue(null),
}));

import { buildMappedItems } from './searchResultMapper';
import { buildSectionedView, categorizeItem } from '../components/list/sectionedListLogic';
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

// Plain-English contract: definition rows and run rows are orthogonal display
// channels. The presence of one never suppresses the other. This guards
// against a previous regression where attributed runs were filtered out when
// their `subjectId` matched a definition row — which left silent agent
// invocations invisible in the launcher.

describe('contract: definition rows and run rows are orthogonal', () => {
  describe('agents', () => {
    it('an active agent run is visible regardless of its def row existing', () => {
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
      expect(ids).toContain('run_r-agent-active');
      expect(ids).toContain('cmd_agents_dyn_grammar');
    });

    it('a kept-done agent thread row is visible alongside its def row', () => {
      const kept = makeRun({
        id: 'r-agent-done',
        kind: 'agent',
        label: 'Translator',
        status: 'succeeded',
        subjectId: 'cmd_agents_dyn_translator',
        endedAt: Date.now(),
      });
      const defRow = makeResult({
        objectId: 'cmd_agents_dyn_translator',
        name: 'Translator',
        type: 'command',
      });

      const { mappedItems } = buildMappedItems({
        searchItems: [defRow],
        activeContext: null,
        shortcutStore: [],
        localSearchValue: '',
        selectedIndex: 0,
        onError: vi.fn(),
        keptAgentRuns: [kept],
        query: '',
      });

      const ids = mappedItems.map((m) => m.object_id);
      expect(ids).toContain('run_r-agent-done');
      expect(ids).toContain('cmd_agents_dyn_translator');
    });

    it('a failed agent run is visible alongside its def row', () => {
      const failed = makeRun({
        id: 'r-agent-failed',
        kind: 'agent',
        label: 'Summarizer',
        status: 'failed',
        subjectId: 'cmd_agents_dyn_summarizer',
        endedAt: Date.now(),
        errorMessage: 'timeout',
      });
      const defRow = makeResult({
        objectId: 'cmd_agents_dyn_summarizer',
        name: 'Summarizer',
        type: 'command',
      });

      const { mappedItems } = buildMappedItems({
        searchItems: [defRow],
        activeContext: null,
        shortcutStore: [],
        localSearchValue: '',
        selectedIndex: 0,
        onError: vi.fn(),
        failedRuns: [failed],
        query: '',
      });

      const ids = mappedItems.map((m) => m.object_id);
      expect(ids).toContain('run_r-agent-failed');
      expect(ids).toContain('cmd_agents_dyn_summarizer');
    });
  });

  describe('scripts', () => {
    it('an active script run is visible alongside its def row', () => {
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
      expect(ids).toContain('run_r-script-active');
      expect(ids).toContain('cmd_scripts_dyn_updates');
    });

    it('a kept-done script result is visible alongside its def row', () => {
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
      expect(ids).toContain('run_r-script-done');
      expect(ids).toContain('cmd_scripts_dyn_hosts');
    });

    it('a failed script run is visible alongside its def row', () => {
      const failed = makeRun({
        id: 'r-script-failed',
        kind: 'shell-script',
        label: 'Broken Script',
        status: 'failed',
        subjectId: 'cmd_scripts_dyn_broken',
        errorMessage: 'exit 1',
        endedAt: Date.now(),
      });
      const defRow = makeResult({
        objectId: 'cmd_scripts_dyn_broken',
        name: 'broken',
        type: 'command',
      });

      const { mappedItems } = buildMappedItems({
        searchItems: [defRow],
        activeContext: null,
        shortcutStore: [],
        localSearchValue: '',
        selectedIndex: 0,
        onError: vi.fn(),
        failedRuns: [failed],
        query: '',
      });

      const ids = mappedItems.map((m) => m.object_id);
      expect(ids).toContain('run_r-script-failed');
      expect(ids).toContain('cmd_scripts_dyn_broken');
    });
  });
});

// Plain-English contract: Scripts and Agents sections are activity surfaces.
// They display run rows only. Definition rows (`cmd_scripts_dyn_*`,
// `cmd_agents_dyn_*`, all other commands) route to Commands and rank through
// the Rust ranker like any other command. Locks in symmetry between the two
// kind sections.

describe('contract: Scripts and Agents sections are status-only', () => {
  it('an idle script def row is NOT filtered out of mappedItems in empty-query mode', () => {
    const defRow = makeResult({
      objectId: 'cmd_scripts_dyn_idle',
      name: 'Idle Script',
      type: 'command',
    });

    const { mappedItems } = buildMappedItems({
      searchItems: [defRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      query: '',
    });

    const ids = mappedItems.map((m) => m.object_id);
    expect(ids).toContain('cmd_scripts_dyn_idle');
  });

  it('an idle script def row categorizes to Commands, not Scripts', () => {
    const defRow = makeResult({
      objectId: 'cmd_scripts_dyn_idle',
      name: 'Idle Script',
      type: 'command',
    });

    const { mappedItems } = buildMappedItems({
      searchItems: [defRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      query: '',
    });

    const defItem = mappedItems.find((m) => m.object_id === 'cmd_scripts_dyn_idle');
    expect(defItem).toBeDefined();
    expect(categorizeItem(defItem!)).toBe('commands');
  });

  it('a script def row with a live run: def goes to Commands, only the run row sits in Scripts', () => {
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

    const rows = buildSectionedView(mappedItems);

    const scriptsIds: string[] = [];
    const commandsIds: string[] = [];
    let bucket: 'scripts' | 'commands' | 'agents' | null = null;
    for (const r of rows) {
      if (r.kind === 'header') {
        bucket = r.section;
        continue;
      }
      if (bucket === 'scripts') scriptsIds.push(r.item.object_id);
      if (bucket === 'commands') commandsIds.push(r.item.object_id);
    }

    expect(scriptsIds).toEqual(['run_r-live']);
    expect(commandsIds).toContain('cmd_scripts_dyn_updates');
  });

  it('regression guard: an idle agent def row still categorizes to Commands', () => {
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
      query: '',
    });

    const defItem = mappedItems.find((m) => m.object_id === 'cmd_agents_dyn_grammar');
    expect(defItem).toBeDefined();
    expect(categorizeItem(defItem!)).toBe('commands');
  });

  it('regression guard: a script run row still categorizes to Scripts', () => {
    const run = makeRun({
      id: 'r-s',
      kind: 'shell-script',
      label: 'Updates',
      status: 'running',
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

    const runItem = mappedItems.find((m) => m.object_id === 'run_r-s');
    expect(runItem).toBeDefined();
    expect(categorizeItem(runItem!)).toBe('scripts');
  });

  it('regression guard: an agent run row still categorizes to Agents', () => {
    const run = makeRun({
      id: 'r-a',
      kind: 'agent',
      label: 'Grammar Fix',
      status: 'running',
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

    const runItem = mappedItems.find((m) => m.object_id === 'run_r-a');
    expect(runItem).toBeDefined();
    expect(categorizeItem(runItem!)).toBe('agents');
  });
});
