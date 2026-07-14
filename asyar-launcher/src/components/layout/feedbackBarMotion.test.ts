import { describe, expect, it } from 'vitest';
import { getFeedbackTextMotion } from './feedbackBarMotion';

describe('getFeedbackTextMotion', () => {
  it('does not animate text that fits', () => {
    expect(getFeedbackTextMotion(180, 180)).toBeNull();
  });

  it('scrolls overflowing text slowly with pauses at both ends', () => {
    expect(getFeedbackTextMotion(300, 180)).toEqual({
      distancePx: 120,
      durationMs: 7714,
    });
  });
});
