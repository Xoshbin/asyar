import { describe, it, expect } from 'vitest';
import {
  isSearchSettled,
  isCompactIdle,
  targetHeight,
  type SearchSettledInputs,
  type CompactIdleInputs,
} from './compactSyncLogic';
import {
  LAUNCHER_HEIGHT_COMPACT,
  LAUNCHER_HEIGHT_DEFAULT,
} from '../../lib/launcher/launcherGeometry';

const settledDefaults: SearchSettledInputs = {
  currentDiagnosticSeverity: null,
  localSearchValue: '',
  isSearchLoading: false,
  lastCompletedQuery: null,
};

const compactDefaults: CompactIdleInputs = {
  initialized: true,
  launchView: 'compact',
  compactExpanded: false,
  activeView: null,
  activeContext: null,
  localSearchValue: '',
  searchExpandSticky: false,
};

describe('isSearchSettled', () => {
  it('returns true when severity is "error" (sticky error → settled outcome)', () => {
    expect(isSearchSettled({ ...settledDefaults, currentDiagnosticSeverity: 'error' })).toBe(true);
  });

  it('returns true when severity is "fatal" (fatal → settled outcome)', () => {
    expect(isSearchSettled({ ...settledDefaults, currentDiagnosticSeverity: 'fatal' })).toBe(true);
  });

  it('returns false when severity is "info" (info auto-clears, does not pin expanded)', () => {
    expect(isSearchSettled({ ...settledDefaults, currentDiagnosticSeverity: 'info' })).toBe(false);
  });

  it('returns false when severity is "warning" (warning does not pin expanded)', () => {
    expect(isSearchSettled({ ...settledDefaults, currentDiagnosticSeverity: 'warning' })).toBe(false);
  });

  it('returns false when no query is typed and no error', () => {
    expect(isSearchSettled(settledDefaults)).toBe(false);
  });

  it('returns false while a search is in flight for the current query', () => {
    expect(
      isSearchSettled({
        ...settledDefaults,
        localSearchValue: 'foo',
        isSearchLoading: true,
        lastCompletedQuery: null,
      }),
    ).toBe(false);
  });

  it('returns true when the latest completed query matches the current input', () => {
    expect(
      isSearchSettled({
        ...settledDefaults,
        localSearchValue: 'foo',
        isSearchLoading: false,
        lastCompletedQuery: 'foo',
      }),
    ).toBe(true);
  });

  it('returns false when the completed query is stale (previous query still in results)', () => {
    expect(
      isSearchSettled({
        ...settledDefaults,
        localSearchValue: 'foobar',
        isSearchLoading: false,
        lastCompletedQuery: 'foo',
      }),
    ).toBe(false);
  });

  it('returns false when loading flag is false but no completed query yet', () => {
    expect(
      isSearchSettled({
        ...settledDefaults,
        localSearchValue: 'foo',
        isSearchLoading: false,
        lastCompletedQuery: null,
      }),
    ).toBe(false);
  });
});

describe('isCompactIdle', () => {
  it('returns false until settings are initialized (Rust-seeded geometry must not be clobbered)', () => {
    expect(isCompactIdle({ ...compactDefaults, initialized: false })).toBe(false);
  });

  it('returns false when launchView is not "compact"', () => {
    expect(isCompactIdle({ ...compactDefaults, launchView: 'default' })).toBe(false);
  });

  it('returns false when user clicked Show More (compactExpanded=true)', () => {
    expect(isCompactIdle({ ...compactDefaults, compactExpanded: true })).toBe(false);
  });

  it('returns false when an extension view is active', () => {
    expect(isCompactIdle({ ...compactDefaults, activeView: { id: 'v' } })).toBe(false);
  });

  it('returns false when a context chip is active with an empty query (Tab committed a portal — window must stay expanded)', () => {
    // Regression: pressing Tab to commit a context chip wipes localSearchValue
    // and flips searchExpandSticky back to false, which used to make the
    // launcher fall back to idle — collapsing the panel and swallowing Enter.
    // An active context is an explicit non-idle state.
    expect(
      isCompactIdle({
        ...compactDefaults,
        activeContext: { provider: { id: 'google' }, query: '' },
      }),
    ).toBe(false);
  });

  it('returns false when a context chip is active and the user is typing into its query', () => {
    expect(
      isCompactIdle({
        ...compactDefaults,
        activeContext: { provider: { id: 'google' }, query: 'hello' },
      }),
    ).toBe(false);
  });

  it('stays true while user is typing but the search has not yet settled (sticky=false)', () => {
    expect(
      isCompactIdle({
        ...compactDefaults,
        localSearchValue: 'foo',
        searchExpandSticky: false,
      }),
    ).toBe(true);
  });

  it('returns false once the search has settled (sticky=true) — window may expand', () => {
    expect(
      isCompactIdle({
        ...compactDefaults,
        localSearchValue: 'foo',
        searchExpandSticky: true,
      }),
    ).toBe(false);
  });

  it('returns true when everything is idle: compact mode, initialized, no query, no view', () => {
    expect(isCompactIdle(compactDefaults)).toBe(true);
  });

  it('ignores sticky gate when there is no query (sticky is only meaningful with a query)', () => {
    expect(
      isCompactIdle({
        ...compactDefaults,
        localSearchValue: '',
        searchExpandSticky: true,
      }),
    ).toBe(true);
  });
});

describe('targetHeight', () => {
  it('returns LAUNCHER_HEIGHT_COMPACT when compactIdle is true', () => {
    expect(targetHeight(true)).toBe(LAUNCHER_HEIGHT_COMPACT);
  });

  it('returns LAUNCHER_HEIGHT_DEFAULT when compactIdle is false', () => {
    expect(targetHeight(false)).toBe(LAUNCHER_HEIGHT_DEFAULT);
  });
});
