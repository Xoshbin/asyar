// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const registeredActions = new Map<string, any>();
vi.mock('../../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn((act) => {
      registeredActions.set(act.id, act);
    }),
    unregisterAction: vi.fn((id) => {
      registeredActions.delete(id);
    }),
  },
}));

vi.mock('./orchestrator', () => ({
  startBuild: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('./questionBridge', () => ({
  submitAnswer: vi.fn().mockResolvedValue(undefined),
}));

import BuildProgressView from './BuildProgressView.svelte';
import { buildJobStore } from './buildJobStore.svelte';

describe('BuildProgressView', () => {
  beforeEach(() => {
    registeredActions.clear();
    buildJobStore.reset();
  });

  it('registers build action in action panel without inline build button or ActionFooter in idle state', async () => {
    const { container } = render(BuildProgressView);

    // Prompt textarea exists
    const textarea = screen.getByPlaceholderText(/Create an extension for/i);
    expect(textarea).toBeTruthy();

    // No inline build button in view body
    expect(screen.queryByRole('button', { name: /Build/i })).toBeNull();

    // No ActionFooter component
    expect(container.querySelector('.action-footer')).toBeNull();

    // Action is registered in action panel (disabled while prompt is empty)
    expect(registeredActions.has('ai-builder:start-build')).toBe(true);
    expect(registeredActions.get('ai-builder:start-build').disabled).toBe(true);

    // Type into prompt to verify action panel registration enables
    await fireEvent.input(textarea, { target: { value: 'Create a GitHub extension' } });
    expect(registeredActions.get('ai-builder:start-build').disabled).toBe(false);
  });

  it('renders inline question confirm buttons when in waiting state', async () => {
    buildJobStore.job = {
      prompt: 'Test prompt',
      dir: '/tmp/test-ext',
      status: 'waiting',
      steps: [{ label: 'Planning' }],
      pendingQuestion: {
        questionId: 'q-1',
        prompt: 'Do you want to use TypeScript?',
        inputKind: 'confirm',
      },
      result: null,
      failure: null,
    };

    const { container } = render(BuildProgressView);

    expect(screen.getByText('Do you want to use TypeScript?')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();

    // Confirm actions are registered in action panel
    expect(registeredActions.has('ai-builder:confirm-yes')).toBe(true);
    expect(registeredActions.has('ai-builder:confirm-no')).toBe(true);

    // No ActionFooter
    expect(container.querySelector('.action-footer')).toBeNull();
  });
});
