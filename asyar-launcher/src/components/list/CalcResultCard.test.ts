// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import CalcResultCard from './CalcResultCard.svelte';
import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';

describe('CalcResultCard', () => {
  beforeEach(() => {
    class MockResizeObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  it('renders normal expression and result labels', () => {
    const item: MappedSearchItem = {
      id: 'calc-1',
      title: '6',
      subtitle: '3+3',
      type: 'result',
      icon: '🧮',
    };

    render(CalcResultCard, { item, index: 0 });

    expect(screen.getByText('3+3')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('Expression')).toBeTruthy();
    expect(screen.getByText('Result')).toBeTruthy();
  });

  it('renders humor Easter egg label for 2+2 evaluated to 1', () => {
    const item: MappedSearchItem = {
      id: 'calc-easter-egg',
      title: '1',
      subtitle: '2+2',
      type: 'result',
      icon: '🧮',
    };

    render(CalcResultCard, { item, index: 0 });

    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('Rounded down for optimization 😅')).toBeTruthy();
  });

  it('handles spaces in 2 + 2 expression for Easter egg label', () => {
    const item: MappedSearchItem = {
      id: 'calc-easter-egg-spaces',
      title: '1',
      subtitle: '2   +   2',
      type: 'result',
      icon: '🧮',
    };

    render(CalcResultCard, { item, index: 0 });

    expect(screen.getByText('Rounded down for optimization 😅')).toBeTruthy();
  });

  it('does not trigger Easter egg label when title is not 1', () => {
    const item: MappedSearchItem = {
      id: 'calc-regular',
      title: '4',
      subtitle: '2+2',
      type: 'result',
      icon: '🧮',
    };

    render(CalcResultCard, { item, index: 0 });

    expect(screen.getByText('Result')).toBeTruthy();
    expect(screen.queryByText('Rounded down for optimization 😅')).toBeNull();
  });

  it('safely handles undefined subtitle without crashing', () => {
    const item: MappedSearchItem = {
      id: 'calc-no-subtitle',
      title: '42',
      type: 'result',
      icon: '🧮',
    };

    expect(() => {
      render(CalcResultCard, { item, index: 0 });
    }).not.toThrow();

    expect(screen.getByText('Result')).toBeTruthy();
  });
});
