import { describe, it, expect } from 'vitest';
import manifest from './manifest.json';

describe('agents manifest shape', () => {
  it('has id agents', () => {
    expect(manifest.id).toBe('agents');
  });

  it('declares manage-agents and ask commands', () => {
    expect(manifest.commands).toHaveLength(2);
    expect(manifest.commands[0].id).toBe('manage-agents');
    expect(manifest.commands[1].id).toBe('ask');
  });

  it('manage-agents command has mode view', () => {
    expect(manifest.commands[0].mode).toBe('view');
  });

  it('manage-agents command has component AgentListView', () => {
    expect(manifest.commands[0].component).toBe('AgentListView');
  });
});
