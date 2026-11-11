// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
const service = vi.hoisted(() => ({
  permissions: [
    { serverId: 'one', toolId: 'tool', agentId: 'agent', decision: 'allow_always' },
    { serverId: 'two', toolId: 'tool', agentId: 'agent', decision: 'allow_always' },
  ],
  refreshPermissions: vi.fn().mockResolvedValue(undefined),
  deletePermission: vi.fn(),
}));
vi.mock('./mcpService.svelte', () => ({ mcpService: service }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
import PermissionsView from './PermissionsView.svelte';
import { actionService } from '../../services/action/actionService.svelte';
it('keeps focus, selection, and Revoke aligned for arrows and clicks', async () => {
  render(PermissionsView);
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
  const rows = screen.getAllByRole('row').slice(1);
  await waitFor(() => expect(document.activeElement).toBe(rows[0]));
  await fireEvent.keyDown(window, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(rows[1]);
  expect(rows[1].getAttribute('tabindex')).toBe('0');
  await actionService
    .getAllActions()
    .find((a) => a.id === 'mcp:revoke-permission')!
    .execute();
  expect(service.deletePermission).toHaveBeenLastCalledWith('two', 'tool', 'agent');
  await fireEvent.click(rows[0]);
  expect(document.activeElement).toBe(rows[0]);
  await actionService
    .getAllActions()
    .find((a) => a.id === 'mcp:revoke-permission')!
    .execute();
  expect(service.deletePermission).toHaveBeenLastCalledWith('one', 'tool', 'agent');
});
