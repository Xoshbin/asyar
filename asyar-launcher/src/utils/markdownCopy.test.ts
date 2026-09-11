// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));
import { feedbackService } from '../services/feedback/feedbackService.svelte';
vi.mock('./copyText', () => ({ copyText: vi.fn() }));
import { copyText } from './copyText';
import { renderMarkdown, handleMarkdownCopyClick } from './markdown';

describe('markdown copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });
  function button() {
    document.body.innerHTML = renderMarkdown('```ts\nconst value = "<&>";\n```');
    return document.querySelector('button')!;
  }
  function click(btn: HTMLButtonElement) {
    const event = new MouseEvent('click');
    Object.defineProperty(event, 'target', { value: btn });
    return handleMarkdownCopyClick(event);
  }
  it('waits for a successful write and prevents overlapping copies', async () => {
    const btn = button();
    let resolve!: (value: boolean) => void;
    vi.mocked(copyText).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const result = click(btn);
    expect(btn.textContent).not.toContain('Copied');
    expect(btn.disabled).toBe(true);
    await click(btn);
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith('const value = "<&>";');
    resolve(true);
    await result;
    expect(btn.textContent).toBe('Copied!');
    await vi.runAllTimersAsync();
    expect(btn.textContent).toBe('Copy');
    expect(btn.disabled).toBe(false);
  });
  it('reports malformed code data without throwing or disabling retry', async () => {
    const btn = button();
    btn.dataset.code = '%invalid';
    await expect(click(btn)).resolves.toBeUndefined();
    expect(copyText).not.toHaveBeenCalled();
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
    expect(btn.disabled).toBe(false);
  });
  it('keeps failed copies available for retry without claiming success', async () => {
    const btn = button();
    vi.mocked(copyText).mockResolvedValueOnce(false);
    await click(btn);
    expect(btn.textContent).toBe('Copy');
    expect(btn.disabled).toBe(false);
  });
});
