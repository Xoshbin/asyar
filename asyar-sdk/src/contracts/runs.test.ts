import { describe, expect, it } from 'vitest';
import type { Run } from './runs';

describe('Run contract', () => {
  it('carries an optional subjectId for the run-to-item join', () => {
    const r: Run = {
      id: 'r1',
      kind: 'shell-script',
      label: 'Hosts Update',
      status: 'running',
      startedAt: 1_700_000_000_000,
      cancellable: false,
      subjectId: 'cmd_scripts_dyn_abc',
    };
    expect(r.subjectId).toBe('cmd_scripts_dyn_abc');
  });

  it('accepts a Run without subjectId (ad-hoc / Tier 2 runs)', () => {
    const r: Run = {
      id: 'r1',
      kind: 'custom',
      label: 'misc',
      status: 'pending',
      startedAt: 0,
      cancellable: false,
    };
    expect(r.subjectId).toBeUndefined();
  });
});
