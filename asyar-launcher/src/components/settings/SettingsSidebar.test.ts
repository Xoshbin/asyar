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

  it('matches tabs by keyword, not only by label', async () => {
    const kw = [
      { id: 'general', label: 'General', icon: 'settings', group: 'app', keywords: ['theme'] },
      {
        id: 'built-in-features',
        label: 'Built-in Features',
        icon: 'layers',
        group: 'app',
        keywords: ['clipboard', 'ai'],
      },
      { id: 'about', label: 'About', icon: 'info', group: 'system' },
    ];
    render(SettingsSidebar, { tabs: kw as never, activeTab: 'general' });
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'clipboard' } });
    expect(screen.getByText('Built-in Features')).toBeTruthy();
    expect(screen.queryByText('General')).toBeNull();
    await fireEvent.input(input, { target: { value: 'theme' } });
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.queryByText('Built-in Features')).toBeNull();
  });

  it('shows the ⌘F hint when empty and a clear button once there is a query', async () => {
    render(SettingsSidebar, { tabs: [...tabs], activeTab: 'general' });
    expect(screen.getByText('⌘F')).toBeTruthy();
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'ext' } });
    expect(screen.queryByText('⌘F')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input.value).toBe('');
    expect(screen.getByText('About')).toBeTruthy();
  });

  it('renders the account row as a profile card with name and email when signed in', () => {
    render(SettingsSidebar, {
      tabs: [...tabs],
      activeTab: 'general',
      accountUser: { name: 'ada', email: 'ada@example.com' },
    });
    expect(screen.getByText('ada')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('falls back to the tab label and subtitle when signed out', () => {
    render(SettingsSidebar, { tabs: [...tabs], activeTab: 'general', accountUser: null });
    expect(screen.getByText('Account')).toBeTruthy();
    expect(screen.getByText('Account & Cloud Sync')).toBeTruthy();
  });

  it('shows a count and a badge on the trailing edge', () => {
    const withExtras = [
      { id: 'general', label: 'General', icon: 'settings', group: 'app', count: 7 },
      { id: 'developer', label: 'Developer', icon: 'dev-tools', group: 'system', badge: 'DEV' },
    ];
    render(SettingsSidebar, { tabs: withExtras as never, activeTab: 'general' });
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getAllByText('DEV').length).toBeGreaterThan(0);
  });
});
