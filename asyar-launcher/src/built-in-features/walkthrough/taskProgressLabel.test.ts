import { describe, it, expect } from 'vitest';
import { taskProgressLabel, taskProgressFraction } from './taskProgressLabel';

describe('taskProgressLabel', () => {
  it('names days for a habit task', () => {
    expect(taskProgressLabel({ current: 2, target: 3, unit: 'days' })).toBe('2 of 3 days');
  });

  it('names times for a repetition task', () => {
    expect(taskProgressLabel({ current: 1, target: 5, unit: 'launches' })).toBe('1 of 5 times');
  });

  it('leaves items unqualified, since the noun varies by probe', () => {
    expect(taskProgressLabel({ current: 1, target: 3, unit: 'items' })).toBe('1 of 3');
  });

  it('says nothing for a single-step task', () => {
    // "0 of 1" is a longer way of writing "not done" — the tick already says it.
    expect(taskProgressLabel({ current: 0, target: 1, unit: 'launches' })).toBeNull();
    expect(taskProgressLabel({ current: 1, target: 1, unit: 'launches' })).toBeNull();
  });

  it('says nothing for a manual task', () => {
    expect(taskProgressLabel(null)).toBeNull();
    expect(taskProgressLabel(undefined)).toBeNull();
  });

  it('reads full when the task is done', () => {
    expect(taskProgressLabel({ current: 3, target: 3, unit: 'days' })).toBe('3 of 3 days');
  });
});

describe('taskProgressFraction', () => {
  it('converts progress to a 0..1 fill', () => {
    expect(taskProgressFraction({ current: 1, target: 4, unit: 'days' })).toBe(0.25);
    expect(taskProgressFraction({ current: 4, target: 4, unit: 'days' })).toBe(1);
  });

  it('is zero when there is no progress to show', () => {
    expect(taskProgressFraction(null)).toBe(0);
    expect(taskProgressFraction(undefined)).toBe(0);
  });

  it('never divides by zero or overflows the bar', () => {
    expect(taskProgressFraction({ current: 5, target: 0, unit: 'items' })).toBe(0);
    expect(taskProgressFraction({ current: 99, target: 3, unit: 'days' })).toBe(1);
  });
});
