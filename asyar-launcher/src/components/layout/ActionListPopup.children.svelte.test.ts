// @vitest-environment jsdom
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ActionListPopup from './ActionListPopup.svelte';

vi.mock('../../services/log/logService', () => ({ logService: { debug: vi.fn() } }));
vi.mock('../../services/i18n', () => ({ t: (key: string) => key }));

const action = (id: string, label: string) => ({
  id,
  label,
  displayCategory: 'Default',
  execute: vi.fn(),
});

describe('ActionListPopup nested lists', () => {
  it('stays open on an empty or loading child list and fills in when it loads', async () => {
    const onclose = vi.fn();
    const list = $state({
      apps: null as { id: string; label: string; execute: () => void }[] | null,
    });
    const openWith = { ...action('open-with', 'Open With'), children: () => list.apps };
    const { getByText } = render(ActionListPopup, {
      props: { availableActions: [openWith], onclose },
    });

    await fireEvent.click(getByText('Open With'));
    await tick();
    expect(onclose).not.toHaveBeenCalled();
    expect(getByText('common.loading_ellipsis')).toBeTruthy();

    list.apps = [];
    await tick();
    expect(getByText('dialogs.action_list.no_matching_actions')).toBeTruthy();

    list.apps = [{ id: 'open-with:zed', label: 'Zed', execute: vi.fn() }];
    await tick();
    expect(getByText('Zed')).toBeTruthy();
  });
});
