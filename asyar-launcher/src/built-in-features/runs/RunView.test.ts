/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RunView from './RunView.svelte';
import { runService } from '../../services/run/runService.svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

describe('RunView', () => {
  beforeEach(() => {
    runService.selectedRunId = null;
    runService.active = [];
    runService.recent = [];
  });

  it('renders metadata list for selected run', () => {
    const startedAt = Date.now() - 5000;
    const endedAt = startedAt + 2500;
    const run = {
      id: 'run-1',
      kind: 'shell-script' as const,
      label: 'Build Project',
      status: 'succeeded' as const,
      startedAt,
      endedAt,
      cancellable: false,
    };

    runService.recent = [run];
    runService.selectedRunId = 'run-1';

    render(RunView);

    expect(screen.getByText('Information')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('succeeded')).toBeTruthy();
    expect(screen.getByText('Started')).toBeTruthy();
    expect(screen.getByText('Duration')).toBeTruthy();
    expect(screen.getByText('2.50s')).toBeTruthy();
  });
});
