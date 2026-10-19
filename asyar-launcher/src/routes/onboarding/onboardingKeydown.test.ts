// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { handleOnboardingKeydown } from './onboardingKeydown';

function createKeyEvent(init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  vi.spyOn(event, 'preventDefault');
  return event;
}

describe('handleOnboardingKeydown', () => {
  let onClose: Mock<() => void>;

  beforeEach(() => {
    onClose = vi.fn<() => void>();
  });

  it('triggers close on Cmd+W (macOS)', () => {
    const event = createKeyEvent({
      key: 'w',
      code: 'KeyW',
      metaKey: true,
    });

    const handled = handleOnboardingKeydown(event, { onClose });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('triggers close on Ctrl+W (Windows/Linux)', () => {
    const event = createKeyEvent({
      key: 'w',
      code: 'KeyW',
      ctrlKey: true,
    });

    const handled = handleOnboardingKeydown(event, { onClose });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('triggers close on non-Latin layouts using code KeyW', () => {
    // E.g. Cyrillic layout produces 'ц' while code is 'KeyW'
    const event = createKeyEvent({
      key: 'ц',
      code: 'KeyW',
      ctrlKey: true,
    });

    const handled = handleOnboardingKeydown(event, { onClose });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('triggers close with uppercase W', () => {
    const event = createKeyEvent({
      key: 'W',
      code: 'KeyW',
      metaKey: true,
    });

    const handled = handleOnboardingKeydown(event, { onClose });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ignores shortcuts with conflicting modifiers (Shift, Alt/Option)', () => {
    const withShift = createKeyEvent({
      key: 'w',
      code: 'KeyW',
      metaKey: true,
      shiftKey: true,
    });
    expect(handleOnboardingKeydown(withShift, { onClose })).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    const withAlt = createKeyEvent({
      key: 'w',
      code: 'KeyW',
      ctrlKey: true,
      altKey: true,
    });
    expect(handleOnboardingKeydown(withAlt, { onClose })).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores repeating keydown events when key is held down', () => {
    const event = createKeyEvent({
      key: 'w',
      code: 'KeyW',
      metaKey: true,
      repeat: true,
    });

    const handled = handleOnboardingKeydown(event, { onClose });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores keydown during IME composition', () => {
    const event = createKeyEvent({
      key: 'w',
      code: 'KeyW',
      metaKey: true,
      isComposing: true,
    });

    const handled = handleOnboardingKeydown(event, { onClose });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores unrelated keys or keys without primary modifier', () => {
    const bareW = createKeyEvent({ key: 'w', code: 'KeyW' });
    expect(handleOnboardingKeydown(bareW, { onClose })).toBe(false);

    const cmdQ = createKeyEvent({ key: 'q', code: 'KeyQ', metaKey: true });
    expect(handleOnboardingKeydown(cmdQ, { onClose })).toBe(false);

    expect(onClose).not.toHaveBeenCalled();
  });
});
