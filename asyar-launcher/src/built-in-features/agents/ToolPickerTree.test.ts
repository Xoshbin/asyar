// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolGroup } from '../../lib/ipc/commands';

vi.mock('../mcp/mcpService.svelte', () => ({
  mcpService: { servers: [{ id: 'server-1', displayName: 'Filesystem MCP' }] },
}));

import ToolPickerTree from './ToolPickerTree.svelte';

const sampleGroups: AgentToolGroup[] = [
  {
    kind: 'builtin',
    tools: [
      {
        id: 'calculator',
        fullyQualifiedId: 'builtin:calculator',
        name: 'Calculator',
        description: 'Evaluate math',
        parameters: {},
        source: 'builtin',
      },
    ],
  },
  {
    kind: 'tier2',
    extensionId: 'weather',
    tools: [
      {
        id: 'current',
        fullyQualifiedId: 'weather:current',
        name: 'Weather Forecast',
        description: 'Get forecast',
        parameters: {},
        source: { extensionId: 'weather' },
      },
    ],
  },
];

describe('ToolPickerTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders tool groups and tools', () => {
    render(ToolPickerTree, {
      groups: sampleGroups,
      selectedIds: ['builtin:calculator'],
      droppedToolIds: [],
      onChange: vi.fn(),
    });

    expect(screen.getByText(/Built-in/)).toBeTruthy();
    expect(screen.getByText(/weather/)).toBeTruthy();
    expect(screen.getByText('Calculator')).toBeTruthy();
    expect(screen.getByText('Weather Forecast')).toBeTruthy();
  });

  it('displays inline hint when tool is in droppedToolIds', () => {
    render(ToolPickerTree, {
      groups: sampleGroups,
      selectedIds: ['weather:current'],
      droppedToolIds: ['weather:current'],
      onChange: vi.fn(),
    });

    expect(screen.getByText('Not available in CLI mode')).toBeTruthy();
  });

  it('localizes the dropped-tool hint', async () => {
    const { i18nService } = await import('../../services/i18n');
    i18nService.setLocale('pt-BR');
    try {
      render(ToolPickerTree, {
        groups: sampleGroups,
        selectedIds: ['weather:current'],
        droppedToolIds: ['weather:current'],
        onChange: vi.fn(),
      });

      expect(screen.getByText('Indisponível no modo CLI')).toBeTruthy();
      expect(screen.queryByText('Not available in CLI mode')).toBeNull();
    } finally {
      i18nService.setLocale('en');
    }
  });

  it('toggles tool selection via onChange callback', async () => {
    const onChange = vi.fn();
    render(ToolPickerTree, {
      groups: sampleGroups,
      selectedIds: [],
      droppedToolIds: [],
      onChange,
    });

    const checkbox = screen.getAllByRole('checkbox')[0];
    await fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith(['builtin:calculator']);
  });
});
