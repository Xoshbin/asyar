// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
const service = vi.hoisted(() => ({
  detectedConfigs: [],
  parseConfigJson: vi.fn(),
  install: vi.fn(),
}));
vi.mock('./mcpService.svelte', () => ({ mcpService: service }));
vi.mock('../../services/runtime/runtimeService.svelte', () => ({
  runtimeService: { downloadProgress: null },
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
import ImportServersView from './ImportServersView.svelte';
import { actionService } from '../../services/action/actionService.svelte';
afterEach(() => vi.useRealTimers());
it('clears old results during debounce and ignores an obsolete response', async () => {
  vi.useFakeTimers();
  const deferred: Array<(value: unknown[]) => void> = [];
  service.parseConfigJson.mockImplementation(() => new Promise((r) => deferred.push(r)));
  render(ImportServersView);
  await fireEvent.click(screen.getByRole('button', { name: /paste/i }));
  const input = screen.getByRole('textbox');
  await fireEvent.input(input, { target: { value: 'first' } });
  await vi.advanceTimersByTimeAsync(200);
  deferred[0]([{ id: 'first', displayName: 'First Server' }]);
  await vi.advanceTimersByTimeAsync(0);
  await tick();
  expect(screen.getByText('First Server')).toBeTruthy();
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.input(input, { target: { value: 'second' } });
  expect(screen.queryByText('First Server')).toBeNull();
  expect(actionService.getAllActions().find((a) => a.id === 'mcp:import-submit')?.disabled).toBe(
    true,
  );
  await vi.advanceTimersByTimeAsync(200);
  await fireEvent.input(input, { target: { value: 'third' } });
  deferred[1]([{ id: 'second', displayName: 'Obsolete Server' }]);
  await vi.advanceTimersByTimeAsync(0);
  await tick();
  expect(screen.queryByText('Obsolete Server')).toBeNull();
});
