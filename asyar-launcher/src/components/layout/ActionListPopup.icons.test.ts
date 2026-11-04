// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ActionListPopup from './ActionListPopup.svelte';

vi.mock('../../services/log/logService', () => ({ logService: { debug: vi.fn() } }));
vi.mock('../../services/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../services/action/invokeAction', () => ({ invokeAction: vi.fn() }));

const action = (id: string, icon?: string) => ({
  id,
  label: id,
  icon,
  displayCategory: '',
  execute: () => {},
});

describe('ActionListPopup icon alignment', () => {
  it('gives icon-less actions a spacer when their section has icons', () => {
    const { container } = render(ActionListPopup, {
      props: { availableActions: [action('a', 'icon:copy'), action('b')] },
    });
    expect(container.querySelectorAll('.icon-spacer')).toHaveLength(1);
  });

  it('adds no spacer when no action in the section has an icon', () => {
    const { container } = render(ActionListPopup, {
      props: { availableActions: [action('a'), action('b')] },
    });
    expect(container.querySelectorAll('.icon-spacer')).toHaveLength(0);
  });
});
