// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SettingsSidebar from './SettingsSidebar.svelte';

const tabs = [
  { id: 'account', label: 'Account', icon: 'user', group: 'top' },
  { id: 'general', label: 'General', icon: 'settings', group: 'app' },
  { id: 'extensions', label: 'Extensions', icon: 'puzzle', group: 'app' },
  { id: 'advanced', label: 'Advanced', icon: 'layers', group: 'system' },
  { id: 'about', label: 'About', icon: 'info', group: 'system' },
] as const;

describe('SettingsSidebar', () => {
  it('renders items and group labels, and omits absent tabs', () => {
    render(SettingsSidebar, { tabs: [...tabs], activeTab: 'general' });
    expect(screen.getByText('Account')).toBeTruthy();
    expect(screen.getByText('App')).toBeTruthy();
    expect(screen.getByText('System')).toBeTruthy();
    expect(screen.queryByText('Developer')).toBeNull();
  });

  it('marks the active item with aria-current', () => {
    render(SettingsSidebar, { tabs: [...tabs], activeTab: 'general' });
    expect(screen.getByText('General').closest('button')?.getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByText('About').closest('button')?.getAttribute('aria-current')).toBeNull();
  });

  it('selects a tab on click', async () => {
    const { component } = render(SettingsSidebar, { tabs: [...tabs], activeTab: 'general' });
    await fireEvent.click(screen.getByText('About'));
    expect(screen.getByText('About').closest('button')?.getAttribute('aria-current')).toBe('page');
    void component;
  });

  it('filters items by the search query', async () => {
    render(SettingsSidebar, { tabs: [...tabs], activeTab: 'general' });
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'ext' } });
    expect(screen.getByText('Extensions')).toBeTruthy();
    expect(screen.queryByText('About')).toBeNull();
  });

  it('focuses the search input on Cmd+F', async () => {
    render(SettingsSidebar, { tabs: [...tabs], activeTab: 'general' });
    await fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });
});
