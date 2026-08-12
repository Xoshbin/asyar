// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TabGroup from './TabGroup.svelte';

describe('TabGroup sidebar variant', () => {
  it('renders an icon and a count when provided', () => {
    render(TabGroup, {
      variant: 'sidebar',
      activeTab: 'general',
      tabs: [{ id: 'general', label: 'General', icon: 'settings', count: '412' }],
    });
    expect(screen.getByText('412')).toBeTruthy();
    expect(screen.getByText('General')).toBeTruthy();
  });

  it('renders no count element when count is omitted', () => {
    const { container } = render(TabGroup, {
      variant: 'sidebar',
      activeTab: 'general',
      tabs: [{ id: 'general', label: 'General', icon: 'settings' }],
    });
    expect(container.querySelector('.tab-item-count')).toBeNull();
  });
});
