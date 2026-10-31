// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/log/logService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import CredentialField from './CredentialField.svelte';
import { logService } from '../../services/log/logService';
import type { CredentialState } from '../../bindings';

function setup(
  state: CredentialState,
  overrides: Partial<{
    optional: boolean;
    onSave: (s: string) => Promise<void>;
    onRemove: () => Promise<void>;
  }> = {},
) {
  const onSave = overrides.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onRemove = overrides.onRemove ?? vi.fn().mockResolvedValue(undefined);
  render(CredentialField, {
    label: 'API Key',
    inputId: 'k',
    placeholder: 'sk-…',
    state,
    optional: overrides.optional ?? false,
    onSave,
    onRemove,
  });
  return { onSave, onRemove };
}

describe('CredentialField', () => {
  it('disables Save while the trimmed input is empty, even for an optional key', async () => {
    setup('notConfigured', { optional: true });
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const input = screen.getByPlaceholderText('sk-…') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '   ' } });
    expect(save.disabled).toBe(true);

    await fireEvent.input(input, { target: { value: ' sk-1 ' } });
    expect(save.disabled).toBe(false);
  });

  it('saves the trimmed secret and clears the input right away', async () => {
    const { onSave } = setup('notConfigured');
    const input = screen.getByPlaceholderText('sk-…') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: ' sk-1 ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('sk-1');
    await vi.waitFor(() => expect(input.value).toBe(''));
  });

  it('shows the save error copy and keeps the input when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('raw secret-ish detail'));
    setup('notConfigured', { onSave });
    const input = screen.getByPlaceholderText('sk-…') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'sk-1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("Couldn't save the key. Please try again.")).toBeTruthy();
    expect(screen.queryByText(/raw secret-ish detail/)).toBeNull();
    expect(logService.error).toHaveBeenCalled();
  });

  it('shows the remove error copy (not the save copy) when removing fails', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('nope'));
    setup('configured', { onRemove });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText("Couldn't remove the key. Please try again.")).toBeTruthy();
    expect(screen.queryByText("Couldn't save the key. Please try again.")).toBeNull();
  });

  it('shows only "Key saved" with Replace/Remove for a configured key', async () => {
    setup('configured');
    expect(screen.getByText('Key saved')).toBeTruthy();
    expect(screen.queryByPlaceholderText('sk-…')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByPlaceholderText('sk-…')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Key saved')).toBeTruthy();
  });

  it('shows the re-entry warning with an empty input for needsReentry', () => {
    setup('needsReentry');
    expect(screen.getByText("This key can't be read anymore. Please enter it again.")).toBeTruthy();
    expect((screen.getByPlaceholderText('sk-…') as HTMLInputElement).value).toBe('');
  });
});
