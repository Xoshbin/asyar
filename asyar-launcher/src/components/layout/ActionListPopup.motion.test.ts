// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ActionListPopup from './ActionListPopup.svelte';

vi.mock('../../services/log/logService', () => ({ logService: { debug: vi.fn() } }));
vi.mock('../../services/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../services/action/invokeAction', () => ({ invokeAction: vi.fn() }));

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

describe('ActionListPopup entrance', () => {
  it('mounts in the pre-entrance state', () => {
    const { getByRole } = render(ActionListPopup, { props: { availableActions: [] } });
    expect(getByRole('dialog').classList.contains('entering')).toBe(true);
  });

  it('settles to the resting state within two frames', async () => {
    const { getByRole } = render(ActionListPopup, { props: { availableActions: [] } });
    await nextFrame();
    await nextFrame();
    await tick();
    expect(getByRole('dialog').classList.contains('entering')).toBe(false);
  });

  it('releases its pending frames when unmounted mid-entrance', () => {
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const { unmount } = render(ActionListPopup, { props: { availableActions: [] } });
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it('drives the entrance from motion tokens, not literal durations', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/layout/ActionListPopup.svelte'),
      'utf8',
    );
    const style = source.slice(source.indexOf('<style>'));
    expect(style).toContain('transform-origin: bottom right');
    expect(style).toContain('opacity var(--dur-quick) var(--ease-emerge)');
    expect(style).toContain('transform var(--dur-quick) var(--ease-emerge)');
    expect(style).not.toMatch(/transition:[^;]*\b\d+(?:\.\d+)?m?s\b/);
  });
});
