// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Modal from './Modal.svelte';
it('ignores composing Enter and retains the actionable element guard', async () => {
  const onEnter = vi.fn();
  const { container } = render(Modal, { onEnter, children: (() => {}) as any });
  const dialog = container.querySelector('dialog')!;
  await fireEvent.keyDown(dialog, { key: 'Enter', isComposing: true, ctrlKey: true });
  expect(onEnter).not.toHaveBeenCalled();
  const button = document.createElement('button');
  document.body.append(button);
  button.focus();
  await fireEvent.keyDown(dialog, { key: 'Enter' });
  expect(onEnter).not.toHaveBeenCalled();
  await fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true });
  expect(onEnter).toHaveBeenCalledOnce();
  button.remove();
});
