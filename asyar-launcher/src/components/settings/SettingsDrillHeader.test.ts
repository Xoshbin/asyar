// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SettingsDrillHeader from './SettingsDrillHeader.svelte';

function setup(over: Record<string, unknown> = {}) {
  const onback = vi.fn();
  const onforward = vi.fn();
  render(SettingsDrillHeader, {
    title: 'Clipboard History',
    parentLabel: 'Built-in Features',
    canBack: true,
    canForward: true,
    onback,
    onforward,
    ...over,
  });
  return { onback, onforward };
}

describe('SettingsDrillHeader', () => {
  it('renders the parent as a button that navigates back when drilled in', async () => {
    const { onback } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Built-in Features' }));
    expect(onback).toHaveBeenCalledTimes(1);
  });

  it('renders the parent as plain text when not drilled in', () => {
    setup({ title: undefined, canBack: false });
    expect(screen.queryByRole('button', { name: 'Built-in Features' })).toBeNull();
    expect(screen.getByText('Built-in Features')).toBeTruthy();
  });

  it('goes back on ⌘[ and Alt+ArrowLeft, forward on ⌘] and Alt+ArrowRight', async () => {
    const { onback, onforward } = setup();
    await fireEvent.keyDown(window, { key: '[', metaKey: true });
    await fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(onback).toHaveBeenCalledTimes(2);
    await fireEvent.keyDown(window, { key: ']', metaKey: true });
    await fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    expect(onforward).toHaveBeenCalledTimes(2);
  });

  it('ignores the shortcuts when navigation is unavailable', async () => {
    const { onback, onforward } = setup({ canBack: false, canForward: false });
    await fireEvent.keyDown(window, { key: '[', metaKey: true });
    await fireEvent.keyDown(window, { key: ']', metaKey: true });
    expect(onback).not.toHaveBeenCalled();
    expect(onforward).not.toHaveBeenCalled();
  });

  it('ignores Alt+Arrow while typing in an input', async () => {
    const { onback } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    await fireEvent.keyDown(input, { key: 'ArrowLeft', altKey: true });
    expect(onback).not.toHaveBeenCalled();
    input.remove();
  });
});
