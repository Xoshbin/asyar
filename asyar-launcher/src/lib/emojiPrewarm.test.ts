/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';

import { prewarmEmojiFont } from './emojiPrewarm';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

// The module's one-shot flag persists across tests in this file; the
// idempotence test below deliberately runs after the first prewarm.
describe('prewarmEmojiFont', () => {
  it('paints an offscreen emoji probe and removes it after two frames', async () => {
    const before = document.body.children.length;
    prewarmEmojiFont();

    expect(document.body.children.length).toBe(before + 1);
    const probe = document.body.lastElementChild as HTMLElement;
    expect(probe.getAttribute('aria-hidden')).toBe('true');
    expect(probe.textContent).toBeTruthy();
    // Offscreen, not display:none — the glyphs must reach layout and paint.
    expect(probe.style.position).toBe('fixed');
    expect(probe.style.display).not.toBe('none');

    await nextFrame();
    await nextFrame();
    expect(document.body.contains(probe)).toBe(false);
  });

  it('is one-shot: a second call adds no probe', () => {
    const before = document.body.children.length;
    prewarmEmojiFont();
    expect(document.body.children.length).toBe(before);
  });
});
