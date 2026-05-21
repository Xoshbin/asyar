import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logService before importing (it calls Tauri log plugin at module level)
vi.mock('../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../services/extension/extensionManager.svelte', () => ({
  __esModule: true,
  default: {
    getManifestById: vi.fn(),
    handleCommandAction: vi.fn().mockResolvedValue(undefined),
  },
}))

import extensionManager from '../services/extension/extensionManager.svelte'

vi.mock('../services/application/applicationsService', () => ({
  applicationService: {
    open: vi.fn(),
  },
}))

vi.mock('../services/run/runService.svelte', () => ({
  runService: { selectedRunId: null, active: [], recent: [] },
}))

vi.mock('../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}))

vi.mock('../built-in-features/agents/agentsManager.svelte', () => ({
  agentsManager: { currentAgentId: null, currentThreadId: null },
}))

vi.mock('../built-in-features/agents/agentService.svelte', () => ({
  agentService: { agents: [] as Array<{ id: string; name: string }> },
}))

vi.mock('../built-in-features/scripts/scriptsManager.svelte', () => ({
  scriptsManager: {
    getScriptByDynamicId: vi.fn(),
  },
}))

import { agentService } from '../built-in-features/agents/agentService.svelte'
import { scriptsManager } from '../built-in-features/scripts/scriptsManager.svelte'

import { resolveItemMeta, buildMappedItems } from './searchResultMapper'
import type { SearchResult } from '../services/search/interfaces/SearchResult'
import type { Run } from 'asyar-sdk/contracts'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    objectId: 'test-id',
    name: 'Test Item',
    type: 'command',
    score: 0.5,
    ...overrides,
  } as SearchResult
}

const noManifest = (_id: string) => null

// ── Icon resolution ───────────────────────────────────────────────────────────

describe('icon resolution', () => {
  it('uses the result icon when provided', () => {
    const { icon } = resolveItemMeta(makeResult({ icon: '🎯' }), noManifest)
    expect(icon).toBe('🎯')
  })

  it('falls back to 🖥️ for application type with no icon', () => {
    const { icon } = resolveItemMeta(makeResult({ type: 'application', icon: undefined }), noManifest)
    expect(icon).toBe('🖥️')
  })

  it('falls back to ❯_ for command type with no icon', () => {
    const { icon } = resolveItemMeta(makeResult({ type: 'command', icon: undefined }), noManifest)
    expect(icon).toBe('❯_')
  })

  it('falls back to 🧩 for unknown type with no icon', () => {
    const { icon } = resolveItemMeta(makeResult({ type: undefined, icon: undefined }), noManifest)
    expect(icon).toBe('🧩')
  })

  it('does not override a provided icon even for application type', () => {
    const { icon } = resolveItemMeta(makeResult({ type: 'application', icon: '📦' }), noManifest)
    expect(icon).toBe('📦')
  })
})

// ── TypeLabel resolution ──────────────────────────────────────────────────────

describe('typeLabel resolution', () => {
  it('capitalizes the type string', () => {
    const { typeLabel } = resolveItemMeta(makeResult({ type: 'application' }), noManifest)
    expect(typeLabel).toBe('Application')
  })

  it('uses manifest name for command type when manifest is found', () => {
    const getManifest = (_id: string) => ({ name: 'My Extension' })
    const { typeLabel } = resolveItemMeta(
      makeResult({ type: 'command', extensionId: 'my-ext' }),
      getManifest,
    )
    expect(typeLabel).toBe('My Extension')
  })

  it('falls back to "Command" when manifest is not found', () => {
    const { typeLabel } = resolveItemMeta(
      makeResult({ type: 'command', extensionId: 'unknown-ext' }),
      noManifest,
    )
    expect(typeLabel).toBe('Command')
  })

  it('falls back to "Command" when no extensionId is provided', () => {
    const { typeLabel } = resolveItemMeta(
      makeResult({ type: 'command', extensionId: undefined }),
      noManifest,
    )
    expect(typeLabel).toBe('Command')
  })

  it('does not use manifest name for non-command types', () => {
    const getManifest = (_id: string) => ({ name: 'My Extension' })
    const { typeLabel } = resolveItemMeta(
      makeResult({ type: 'application', extensionId: 'my-ext' }),
      getManifest,
    )
    expect(typeLabel).toBe('Application')
  })

  it('falls back to "Unknown" when type is falsy (defaults to unknown)', () => {
    const { typeLabel } = resolveItemMeta(
      makeResult({ type: undefined as any }),
      noManifest,
    )
    expect(typeLabel).toBe('Unknown')
  })
})

// ── ObjectId resolution ───────────────────────────────────────────────────────

describe('objectId resolution', () => {
  it('returns the result objectId when present', () => {
    const { objectId } = resolveItemMeta(makeResult({ objectId: 'calc-cmd-1' }), noManifest)
    expect(objectId).toBe('calc-cmd-1')
  })

  it('generates a fallback id when objectId is missing', () => {
    const { objectId } = resolveItemMeta(makeResult({ objectId: undefined as any }), noManifest)
    expect(objectId).toMatch(/^fallback_id_/)
  })

  it('generates a fallback id when objectId is an empty string', () => {
    const { objectId } = resolveItemMeta(makeResult({ objectId: '' }), noManifest)
    expect(objectId).toMatch(/^fallback_id_/)
  })
})

// ── buildMappedItems: style & description pass-through ───────────────────────

describe('buildMappedItems preserves calculator fields', () => {
  it('maps style: "large" from SearchResult to MappedSearchItem', () => {
    const calcResult = makeResult({
      objectId: 'ext_calculator_42_0',
      name: '42',
      description: '6 * 7',
      type: 'command',
      score: 1.0,
      icon: '🧮',
      style: 'large',
      action: () => {},
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [calcResult],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '6 * 7',
      selectedIndex: 0,
      onError: vi.fn(),
    })

    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].style).toBe('large')
    expect(mappedItems[0].subtitle).toBe('6 * 7')
    expect(mappedItems[0].icon).toBe('🧮')
  })

  it('maps style: undefined for non-calculator results', () => {
    const appResult = makeResult({
      objectId: 'app_safari',
      name: 'Safari',
      type: 'application',
      score: 0.9,
      path: '/Applications/Safari.app',
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [appResult],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'saf',
      selectedIndex: 0,
      onError: vi.fn(),
    })

    expect(mappedItems[0].style).toBeUndefined()
  })
})

// ── buildMappedItems: command action return value propagation ────────────────

describe('buildMappedItems command action returns result', () => {
  it('propagates the return value from handleCommandAction', async () => {
    vi.mocked(extensionManager.handleCommandAction).mockResolvedValueOnce({ type: 'no-view' })

    const cmdResult = makeResult({
      objectId: 'cmd_quit_quit-asyar',
      name: 'Quit Asyar',
      type: 'command',
      score: 1.0,
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [cmdResult],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'quit',
      selectedIndex: 0,
      onError: vi.fn(),
    })

    const result = await mappedItems[0].action()
    expect(result).toEqual({ type: 'no-view' })
  })

  it('returns undefined when command returns undefined (e.g. cancelled)', async () => {
    vi.mocked(extensionManager.handleCommandAction).mockResolvedValueOnce(undefined)

    const cmdResult = makeResult({
      objectId: 'cmd_quit_quit-asyar',
      name: 'Quit Asyar',
      type: 'command',
      score: 1.0,
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [cmdResult],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'quit',
      selectedIndex: 0,
      onError: vi.fn(),
    })

    const result = await mappedItems[0].action()
    expect(result).toBeUndefined()
  })
})

// ── buildMappedItems: portal command captures activeContext.query ─────────────

function makePortalContext(query: string) {
  return {
    provider: {
      id: 'portal_1',
      type: 'url' as const,
      display: { name: 'Google', icon: '🔍' },
      triggers: ['Google'],
    },
    query,
  }
}

describe('buildMappedItems: portal command uses activeContext.query', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes activeContext.query to handleCommandAction when non-empty', async () => {
    const { mappedItems } = buildMappedItems({
      searchItems: [],
      activeContext: makePortalContext('hello world'),
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
    })
    await mappedItems[0].action()
    expect(vi.mocked(extensionManager.handleCommandAction)).toHaveBeenCalledWith(
      'cmd_portals_1',
      { query: 'hello world' },
    )
  })

  it('passes empty string when activeContext.query is empty', async () => {
    const { mappedItems } = buildMappedItems({
      searchItems: [],
      activeContext: makePortalContext(''),
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
    })
    await mappedItems[0].action()
    expect(vi.mocked(extensionManager.handleCommandAction)).toHaveBeenCalledWith(
      'cmd_portals_1',
      { query: '' },
    )
  })

  it('uses localSearchValue for non-portal commands', async () => {
    const result = makeResult({ objectId: 'cmd_calc', type: 'command' })
    const { mappedItems } = buildMappedItems({
      searchItems: [result],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'typed text',
      selectedIndex: 0,
      onError: vi.fn(),
    })
    await mappedItems[0].action()
    expect(vi.mocked(extensionManager.handleCommandAction)).toHaveBeenCalledWith(
      'cmd_calc',
      { query: 'typed text' },
    )
  })
})

// ── buildMappedItems: run injection query-awareness ───────────────────────────

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    kind: 'agent',
    label: 'test run',
    status: 'running',
    startedAt: Date.now(),
    cancellable: true,
    ...overrides,
  }
}

describe('buildMappedItems run injection', () => {
  // ── Empty query: runs prepended (sectioned-list / default-mode browse view) ──
  it('empty query: runs are prepended before search results', () => {
    const run = makeRun({ id: 'r1', label: 'ping -c 30 127.0.0.1', kind: 'shell-script' })
    const searchItem = makeResult({ objectId: 'cmd_safari', name: 'Safari' })

    const { mappedItems } = buildMappedItems({
      searchItems: [searchItem],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [run],
      query: '',
    })

    expect(mappedItems).toHaveLength(2)
    expect(mappedItems[0].object_id).toBe('run_r1')
    expect(mappedItems[1].object_id).toBe('cmd_safari')
  })

  // ── Tier-based interleaving when query is non-empty ──

  // A higher-tier run beats a lower-tier mappedItem.
  // (Prefix run "sdk-build" tier 2; non-matching mappedItem "ZZZ" tier 4 → run first.)
  it('non-empty query: higher-tier run is inserted before lower-tier search result', () => {
    const run = makeRun({ id: 'r-sdk', label: 'sdk-build', kind: 'shell-script' })
    const searchItem = makeResult({ objectId: 'cmd_zzz', name: 'ZZZ' })

    const { mappedItems } = buildMappedItems({
      searchItems: [searchItem],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'sdk',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [run],
      query: 'sdk',
    })

    expect(mappedItems).toHaveLength(2)
    expect(mappedItems[0].object_id).toBe('run_r-sdk')
    expect(mappedItems[1].object_id).toBe('cmd_zzz')
  })

  // Catalog wins ties at the same tier (Rust's within-tier ordering is preserved).
  // (Both "sdk-cli" mapped and "sdk-build" run are tier 2 prefix matches → catalog first.)
  it('non-empty query: catalog wins ties within the same tier', () => {
    const run = makeRun({ id: 'r-sdk-build', label: 'sdk-build', kind: 'shell-script' })
    const searchItem = makeResult({ objectId: 'cmd_sdk_cli', name: 'sdk-cli' })

    const { mappedItems } = buildMappedItems({
      searchItems: [searchItem],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'sdk',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [run],
      query: 'sdk',
    })

    expect(mappedItems).toHaveLength(2)
    expect(mappedItems[0].object_id).toBe('cmd_sdk_cli')
    expect(mappedItems[1].object_id).toBe('run_r-sdk-build')
  })

  // Exact-match run (tier 1) beats prefix mappedItem (tier 2).
  it('non-empty query: exact-match run beats prefix-match search result', () => {
    const run = makeRun({ id: 'r-sdk-exact', label: 'sdk', kind: 'shell-script' })
    const searchItem = makeResult({ objectId: 'cmd_sdk_cli', name: 'sdk-cli' })

    const { mappedItems } = buildMappedItems({
      searchItems: [searchItem],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'sdk',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [run],
      query: 'sdk',
    })

    expect(mappedItems).toHaveLength(2)
    expect(mappedItems[0].object_id).toBe('run_r-sdk-exact')
    expect(mappedItems[1].object_id).toBe('cmd_sdk_cli')
  })

  // Non-matching runs (tier 4) go to the bottom of the list.
  it('non-empty query: non-matching run sinks to the bottom', () => {
    const run = makeRun({ id: 'r-ping', label: 'ping -c 30 127.0.0.1', kind: 'shell-script' })
    const searchItem = makeResult({ objectId: 'cmd_sdk_play', name: 'SDK Playground' })

    const { mappedItems } = buildMappedItems({
      searchItems: [searchItem],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'sdk',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [run],
      query: 'sdk',
    })

    expect(mappedItems).toHaveLength(2)
    expect(mappedItems[0].object_id).toBe('cmd_sdk_play')
    expect(mappedItems[1].object_id).toBe('run_r-ping')
  })

  // End-to-end mix: matching runs interleave by tier; non-matching runs go last.
  // mappedItems: ["sdk-cli" tier2, "weird" tier4]; runs: ["sdk-build" tier2, "ping" tier4].
  // Walking mappedItems:
  //   sdk-cli (t2) → no tier<2 runs → push sdk-cli
  //   weird (t4) → sdk-build (t2 < 4) → push sdk-build → push weird
  //   end → no remaining matching runs
  // Non-matching at end: ping
  // → [sdk-cli, sdk-build, weird, ping]
  it('non-empty query: matching runs interleave, non-matching stay at the bottom', () => {
    const runSdkBuild = makeRun({ id: 'r-sdk-build', label: 'sdk-build', kind: 'shell-script' })
    const runPing    = makeRun({ id: 'r-ping',      label: 'ping',      kind: 'shell-script' })
    const sdkCli = makeResult({ objectId: 'cmd_sdk_cli', name: 'sdk-cli' })
    const weird  = makeResult({ objectId: 'cmd_weird',   name: 'weird'   })

    const { mappedItems } = buildMappedItems({
      searchItems: [sdkCli, weird],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'sdk',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [runSdkBuild, runPing],
      query: 'sdk',
    })

    expect(mappedItems).toHaveLength(4)
    expect(mappedItems[0].object_id).toBe('cmd_sdk_cli')
    expect(mappedItems[1].object_id).toBe('run_r-sdk-build')
    expect(mappedItems[2].object_id).toBe('cmd_weird')
    expect(mappedItems[3].object_id).toBe('run_r-ping')
  })

  // Failed and kept-agent runs participate in tier interleaving like active runs.
  // mappedItem "foo" tier4; failedRun "ping failure" tier4 (no match); keptRun "sdk agent" tier2.
  // Walking foo (t4): kept "sdk agent" (t2 < 4) → push kept → push foo.
  // Non-matching at end: failed "ping failure".
  // → [sdk agent (kept), foo (mapped), ping failure (failed)]
  it('non-empty query: failed and kept runs obey the same tier interleaving', () => {
    const failedRun = makeRun({ id: 'r-fail-ping', label: 'ping failure', status: 'failed',    kind: 'shell-script' })
    const keptRun   = makeRun({ id: 'r-kept-sdk',  label: 'sdk agent',    status: 'succeeded', kind: 'agent'        })
    const foo = makeResult({ objectId: 'cmd_foo', name: 'foo' })

    const { mappedItems } = buildMappedItems({
      searchItems: [foo],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'sdk',
      selectedIndex: 0,
      onError: vi.fn(),
      failedRuns: [failedRun],
      keptAgentRuns: [keptRun],
      query: 'sdk',
    })

    expect(mappedItems).toHaveLength(3)
    expect(mappedItems[0].object_id).toBe('run_r-kept-sdk')
    expect(mappedItems[1].object_id).toBe('cmd_foo')
    expect(mappedItems[2].object_id).toBe('run_r-fail-ping')
  })

  // selectedOriginal must still resolve correctly when the user lands on an
  // interleaved mappedItem (i.e., its UI position is no longer == baseItems index).
  it('non-empty query: selectedOriginal resolves the right SearchResult after interleaving', () => {
    const run = makeRun({ id: 'r-sdk', label: 'sdk-build', kind: 'shell-script' })
    const zzz = makeResult({ objectId: 'cmd_zzz', name: 'ZZZ' })

    // Layout: [run, zzz] — selectedIndex=1 points at zzz, which is baseItems[0].
    const { selectedOriginal } = buildMappedItems({
      searchItems: [zzz],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'sdk',
      selectedIndex: 1,
      onError: vi.fn(),
      activeRuns: [run],
      query: 'sdk',
    })

    expect(selectedOriginal?.objectId).toBe('cmd_zzz')
  })

  // selectedOriginal is null when the user lands on a run row.
  it('non-empty query: selectedOriginal is null when selection is a run', () => {
    const run = makeRun({ id: 'r-sdk', label: 'sdk-build', kind: 'shell-script' })
    const zzz = makeResult({ objectId: 'cmd_zzz', name: 'ZZZ' })

    // Layout: [run, zzz] — selectedIndex=0 points at the run.
    const { selectedOriginal } = buildMappedItems({
      searchItems: [zzz],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'sdk',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [run],
      query: 'sdk',
    })

    expect(selectedOriginal).toBeNull()
  })

  // ── Attributed run deduplication ──────────────────────────────────────────
  // When a run's subjectId matches a definition row's object_id in the mapped
  // search items, the run row should NOT be injected. The definition row's
  // status dot (via statusForRow) carries the "active" signal — showing both
  // duplicates the information and confuses keyboard navigation.

  it('empty query: filters out attributed runs whose subjectId matches a definition row', () => {
    const run = makeRun({
      id: 'r-upd',
      label: '/Users/me/scripts/updates.sh',
      kind: 'shell-script',
      subjectId: 'cmd_scripts_dyn_updates',
    })
    const defRow = makeResult({
      objectId: 'cmd_scripts_dyn_updates',
      name: 'updates',
      type: 'command',
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [defRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [run],
      query: '',
    })

    // Only the definition row survives — no run row with the full path
    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].object_id).toBe('cmd_scripts_dyn_updates')
  })

  it('empty query: anonymous runs (no subjectId) are still injected', () => {
    const anonRun = makeRun({
      id: 'r-anon',
      label: 'ping -c 30 127.0.0.1',
      kind: 'shell-script',
      // no subjectId — Tier 2 (sdk-playground) spawns don't set one
    })
    const defRow = makeResult({
      objectId: 'cmd_updates',
      name: 'updates',
      type: 'command',
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [defRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [anonRun],
      query: '',
    })

    // Both the anonymous run and the definition row show
    expect(mappedItems).toHaveLength(2)
    expect(mappedItems[0].object_id).toBe('run_r-anon')
    expect(mappedItems[1].object_id).toBe('cmd_updates')
  })

  it('empty query: attributed run is hidden even when other anonymous runs exist', () => {
    const attributedRun = makeRun({
      id: 'r-attr',
      label: '/Users/me/scripts/updates.sh',
      kind: 'shell-script',
      subjectId: 'cmd_scripts_dyn_updates',
    })
    const anonRun = makeRun({
      id: 'r-anon',
      label: 'ping -c 30 127.0.0.1',
      kind: 'shell-script',
    })
    const defRow = makeResult({
      objectId: 'cmd_scripts_dyn_updates',
      name: 'updates',
      type: 'command',
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [defRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [attributedRun, anonRun],
      query: '',
    })

    // Anonymous run + definition row (attributed run is hidden)
    expect(mappedItems).toHaveLength(2)
    expect(mappedItems[0].object_id).toBe('run_r-anon')
    expect(mappedItems[1].object_id).toBe('cmd_scripts_dyn_updates')
  })

  it('non-empty query: attributed runs are filtered out of tier interleaving', () => {
    const run = makeRun({
      id: 'r-upd',
      label: '/Users/me/scripts/updates.sh',
      kind: 'shell-script',
      subjectId: 'cmd_scripts_dyn_updates',
    })
    const defRow = makeResult({
      objectId: 'cmd_scripts_dyn_updates',
      name: 'updates',
      type: 'command',
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [defRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'upd',
      selectedIndex: 0,
      onError: vi.fn(),
      activeRuns: [run],
      query: 'upd',
    })

    // Only the definition row — run is attributed and suppressed
    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].object_id).toBe('cmd_scripts_dyn_updates')
  })

  it('non-empty query: attributed failed runs are also filtered out', () => {
    const failedRun = makeRun({
      id: 'r-fail-upd',
      label: '/Users/me/scripts/updates.sh',
      status: 'failed',
      kind: 'shell-script',
      subjectId: 'cmd_scripts_dyn_updates',
    })
    const defRow = makeResult({
      objectId: 'cmd_scripts_dyn_updates',
      name: 'updates',
      type: 'command',
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [defRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: 'upd',
      selectedIndex: 0,
      onError: vi.fn(),
      failedRuns: [failedRun],
      query: 'upd',
    })

    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].object_id).toBe('cmd_scripts_dyn_updates')
  })

  it('empty query: attributed failed runs are filtered out', () => {
    const failedRun = makeRun({
      id: 'r-fail-upd',
      label: '/Users/me/scripts/updates.sh',
      status: 'failed',
      kind: 'shell-script',
      subjectId: 'cmd_scripts_dyn_updates',
    })
    const defRow = makeResult({
      objectId: 'cmd_scripts_dyn_updates',
      name: 'updates',
      type: 'command',
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [defRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      failedRuns: [failedRun],
      query: '',
    })

    // Only the definition row — the failed run with matching subjectId is hidden
    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].object_id).toBe('cmd_scripts_dyn_updates')
  })

  it('empty query: idle shell script definitions are filtered out of results', () => {
    const scriptRow = makeResult({
      objectId: 'cmd_scripts_dyn_myscript',
      name: 'My Script',
      type: 'command',
    })
    const appRow = makeResult({
      objectId: 'cmd_safari',
      name: 'Safari',
      type: 'command',
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [scriptRow, appRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      query: '',
    })

    // Only the non-script command survives, the idle script row is filtered out
    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].object_id).toBe('cmd_safari')
  })
})

describe('buildMappedItems script-result rows surface tail output', () => {
  it('script definition stays visible when a scriptResultRun matches its objectId', () => {
    const scriptRow = makeResult({
      objectId: 'cmd_scripts_dyn_hosts',
      name: 'Hosts Update',
      type: 'command',
    })
    const result = makeRun({
      id: 'r-hosts-1',
      label: 'Hosts Update',
      kind: 'shell-script',
      status: 'succeeded',
      subjectId: 'cmd_scripts_dyn_hosts',
      tailOutput: 'OK — synced 12 files',
      endedAt: Date.now(),
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [scriptRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      scriptResultRuns: [result],
      query: '',
    })

    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].object_id).toBe('cmd_scripts_dyn_hosts')
    expect(mappedItems[0].subtitle).toBe('OK — synced 12 files')
  })

  it('failed run subtitle prefers tailOutput over errorMessage', () => {
    const scriptRow = makeResult({
      objectId: 'cmd_scripts_dyn_broken',
      name: 'Broken Script',
      type: 'command',
    })
    const run = makeRun({
      id: 'r-broken',
      label: 'Broken Script',
      kind: 'shell-script',
      status: 'failed',
      subjectId: 'cmd_scripts_dyn_broken',
      tailOutput: 'Error: file not found',
      errorMessage: 'exit code 1',
      endedAt: Date.now(),
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [scriptRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      failedRuns: [run],
      query: '',
    })

    expect(mappedItems[0].subtitle).toBe('Error: file not found')
  })

  it('failed run subtitle falls back to errorMessage when tailOutput is missing', () => {
    const scriptRow = makeResult({
      objectId: 'cmd_scripts_dyn_silent',
      name: 'Silent',
      type: 'command',
    })
    const run = makeRun({
      id: 'r-silent',
      label: 'Silent',
      kind: 'shell-script',
      status: 'failed',
      subjectId: 'cmd_scripts_dyn_silent',
      errorMessage: 'exit code 137',
      endedAt: Date.now(),
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [scriptRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      failedRuns: [run],
      query: '',
    })

    expect(mappedItems[0].subtitle).toBe('exit code 137')
  })

  it('succeeded run with no tailOutput shows "(no output)"', () => {
    const scriptRow = makeResult({
      objectId: 'cmd_scripts_dyn_quiet',
      name: 'Quiet',
      type: 'command',
    })
    const run = makeRun({
      id: 'r-quiet',
      label: 'Quiet',
      kind: 'shell-script',
      status: 'succeeded',
      subjectId: 'cmd_scripts_dyn_quiet',
      tailOutput: undefined,
      endedAt: Date.now(),
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [scriptRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      scriptResultRuns: [run],
      query: '',
    })

    expect(mappedItems[0].subtitle).toBe('(no output)')
  })
})

// ── buildMappedItems: reify missing definitions for surfaced runs ─────────────
//
// The Rust search index truncates merged_search to 20 results, so a low-frecency
// script can fall out of `searchItems` even while its kept-success run lives in
// `unacknowledgedScriptResults`. Without reify, that run renders standalone as
// a `run-done` row with its frozen `run.label` (often a full path). The fix
// reaches into scriptsManager / agentService to synthesize the missing
// definition so attribution succeeds and the definition row template renders
// instead — with the run's tailOutput merged in as the subtitle.

describe('buildMappedItems reifies missing definitions for surfaced runs', () => {
  beforeEach(() => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReset()
    agentService.agents = []
  })

  it('reifies a script definition when its kept-success run is not in baseItems', () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue({
      absolutePath: '/Applications/Asyar Scripts/random-words-1.sh',
      dynamicId: '80562fa4a7c2da5c',
      executable: true,
      header: {
        title: null,
        icon: null,
        arguments: [],
        mode: 'fullOutput',
        refreshTimeSeconds: null,
        refreshTimeClamped: false,
      },
    } as any)

    const result = makeRun({
      id: 'r-rw1',
      label: '/Applications/Asyar Scripts/random-words-1.sh',
      kind: 'shell-script',
      status: 'succeeded',
      subjectId: 'cmd_scripts_dyn_80562fa4a7c2da5c',
      tailOutput: 'quartz',
      endedAt: Date.now(),
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [], // truncated out of the top-20
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      scriptResultRuns: [result],
      query: '',
    })

    // One row: the reified definition, attributed to the run.
    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].object_id).toBe('cmd_scripts_dyn_80562fa4a7c2da5c')
    expect(mappedItems[0].title).toBe('random-words-1') // filename-derived, not the full path
    expect(mappedItems[0].icon).toBe('icon:terminal')
    expect(mappedItems[0].subtitle).toBe('quartz')
    // No orphan run-done row.
    expect(mappedItems.find((m) => m.type === 'run-done')).toBeUndefined()
  })

  it('reifies using header.title when the script declares one', () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue({
      absolutePath: '/scripts/foo.sh',
      dynamicId: 'abc',
      executable: true,
      header: {
        title: 'My Pretty Script',
        icon: 'icon:rocket',
        arguments: [],
        mode: 'compact',
        refreshTimeSeconds: null,
        refreshTimeClamped: false,
      },
    } as any)

    const { mappedItems } = buildMappedItems({
      searchItems: [],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      scriptResultRuns: [makeRun({
        id: 'r-foo', kind: 'shell-script', status: 'succeeded',
        subjectId: 'cmd_scripts_dyn_abc', tailOutput: 'ok', endedAt: Date.now(),
      })],
      query: '',
    })

    expect(mappedItems[0].title).toBe('My Pretty Script')
    expect(mappedItems[0].icon).toBe('icon:rocket')
  })

  it('reifies an agent definition when its kept run is not in baseItems', () => {
    agentService.agents = [{ id: 'agent-42', name: 'Researcher' } as any]

    const { mappedItems } = buildMappedItems({
      searchItems: [],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      keptAgentRuns: [makeRun({
        id: 'r-agent', kind: 'agent', status: 'succeeded',
        subjectId: 'cmd_agents_dyn_agent-42', tailOutput: 'thread done', endedAt: Date.now(),
      })],
      query: '',
    })

    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].object_id).toBe('cmd_agents_dyn_agent-42')
    expect(mappedItems[0].title).toBe('Researcher')
    expect(mappedItems[0].icon).toBe('icon:sparkles')
    expect(mappedItems[0].subtitle).toBe('thread done')
  })

  it('skips reify when the dynamic id is unknown to the in-memory registry', () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(undefined)

    const run = makeRun({
      id: 'r-orphan',
      label: '/tmp/deleted.sh',
      kind: 'shell-script',
      status: 'succeeded',
      subjectId: 'cmd_scripts_dyn_ghost',
      tailOutput: 'ok',
      endedAt: Date.now(),
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      scriptResultRuns: [run],
      query: '',
    })

    // No reify available, falls back to the standalone run-done row.
    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].type).toBe('run-done')
    expect(mappedItems[0].title).toBe('/tmp/deleted.sh')
  })

  it('does not duplicate when the definition is already in baseItems', () => {
    const scriptRow = makeResult({
      objectId: 'cmd_scripts_dyn_present',
      name: 'Already Indexed',
      type: 'command',
    })

    const { mappedItems } = buildMappedItems({
      searchItems: [scriptRow],
      activeContext: null,
      shortcutStore: [],
      localSearchValue: '',
      selectedIndex: 0,
      onError: vi.fn(),
      scriptResultRuns: [makeRun({
        id: 'r-present', kind: 'shell-script', status: 'succeeded',
        subjectId: 'cmd_scripts_dyn_present', tailOutput: 'done', endedAt: Date.now(),
      })],
      query: '',
    })

    expect(mappedItems).toHaveLength(1)
    expect(mappedItems[0].object_id).toBe('cmd_scripts_dyn_present')
    expect(mappedItems[0].title).toBe('Already Indexed')
    // scriptsManager.getScriptByDynamicId should not have been consulted —
    // the definition was already present in baseItems.
    expect(scriptsManager.getScriptByDynamicId).not.toHaveBeenCalled()
  })
})
