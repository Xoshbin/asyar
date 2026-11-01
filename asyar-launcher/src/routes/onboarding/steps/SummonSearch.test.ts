import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateShortcut = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const getShortcutBackendInfo = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ isWayland: false, compositor: null, isOmarchy: false }),
);

vi.mock('../../../utils/shortcutManager', () => ({
  updateShortcut,
}));
vi.mock('../../../lib/ipc/shortcutCommands', () => ({
  getShortcutBackendInfo,
}));

import { saveHotkey, getWaylandBindingGuide, fetchShortcutBackendInfo } from './summonSearchSetup';

describe('SummonSearch saveHotkey', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the chosen modifier+key', async () => {
    await saveHotkey({ modifier: 'Super', key: 'K' });
    expect(updateShortcut).toHaveBeenCalledWith('Super', 'K');
  });

  it('returns true on success', async () => {
    updateShortcut.mockResolvedValue(true);
    const result = await saveHotkey({ modifier: 'Alt', key: 'Space' });
    expect(result).toBe(true);
  });

  it('returns error string when updateShortcut fails', async () => {
    updateShortcut.mockResolvedValue(false);
    const result = await saveHotkey({ modifier: 'Alt', key: 'Space' });
    expect(result).toBe('Could not set that shortcut');
  });
});

describe('getWaylandBindingGuide', () => {
  it('returns null when info is null or not Wayland', () => {
    expect(getWaylandBindingGuide(null)).toBeNull();
    expect(getWaylandBindingGuide(undefined)).toBeNull();
    expect(
      getWaylandBindingGuide({ isWayland: false, compositor: null, isOmarchy: false }),
    ).toBeNull();
  });

  it('returns Omarchy v4 Lua binding snippet when isOmarchy and omarchyLuaConfig are true', () => {
    expect(
      getWaylandBindingGuide({
        isWayland: true,
        compositor: 'hyprland',
        isOmarchy: true,
        omarchyLuaConfig: true,
      }),
    ).toEqual({
      compositorLabel: 'Hyprland (Omarchy)',
      configPath: '~/.config/hypr/bindings.lua',
      command: 'hl.unbind("SUPER + SPACE")\no.bind("SUPER + SPACE", "Asyar", "asyar-summon")',
      shortcutDisplay: 'Super+Space',
      isOmarchy: true,
    });
  });

  it('returns Omarchy v3 conf binding snippet when isOmarchy is true and omarchyLuaConfig is false', () => {
    expect(
      getWaylandBindingGuide({
        isWayland: true,
        compositor: 'hyprland',
        isOmarchy: true,
        omarchyLuaConfig: false,
      }),
    ).toEqual({
      compositorLabel: 'Hyprland (Omarchy)',
      configPath: '~/.config/hypr/bindings.conf',
      command: 'unbind = SUPER, SPACE\nbindd = SUPER, SPACE, Asyar, exec, asyar-summon',
      shortcutDisplay: 'Super+Space',
      isOmarchy: true,
    });
  });

  it('returns standard Hyprland binding snippet when isOmarchy is false', () => {
    expect(
      getWaylandBindingGuide({ isWayland: true, compositor: 'hyprland', isOmarchy: false }),
    ).toEqual({
      compositorLabel: 'Hyprland',
      configPath: '~/.config/hypr/hyprland.conf',
      command: 'bind = $mainMod, SPACE, exec, asyar-summon',
      shortcutDisplay: 'Super+Space',
      isOmarchy: false,
    });
  });

  it('returns Sway binding snippet', () => {
    expect(
      getWaylandBindingGuide({ isWayland: true, compositor: 'sway', isOmarchy: false }),
    ).toEqual({
      compositorLabel: 'Sway',
      configPath: '~/.config/sway/config',
      command: 'bindsym $mod+space exec asyar-summon',
      shortcutDisplay: 'Super+Space',
      isOmarchy: false,
    });
  });

  it('returns desktop shortcut command for KDE, GNOME, and generic Wayland', () => {
    expect(
      getWaylandBindingGuide({ isWayland: true, compositor: 'kde', isOmarchy: false }),
    ).toEqual({
      compositorLabel: 'KDE Plasma',
      configPath: null,
      command: 'asyar-summon',
      shortcutDisplay: 'asyar-summon',
      isOmarchy: false,
    });

    expect(
      getWaylandBindingGuide({ isWayland: true, compositor: 'gnome', isOmarchy: false }),
    ).toEqual({
      compositorLabel: 'GNOME',
      configPath: null,
      command: 'asyar-summon',
      shortcutDisplay: 'asyar-summon',
      isOmarchy: false,
    });

    expect(
      getWaylandBindingGuide({ isWayland: true, compositor: 'other', isOmarchy: false }),
    ).toEqual({
      compositorLabel: 'Wayland',
      configPath: null,
      command: 'asyar-summon',
      shortcutDisplay: 'asyar-summon',
      isOmarchy: false,
    });

    expect(getWaylandBindingGuide({ isWayland: true, compositor: null, isOmarchy: false })).toEqual(
      {
        compositorLabel: 'Wayland',
        configPath: null,
        command: 'asyar-summon',
        shortcutDisplay: 'asyar-summon',
        isOmarchy: false,
      },
    );
  });
});

describe('fetchShortcutBackendInfo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns backend info from IPC', async () => {
    getShortcutBackendInfo.mockResolvedValueOnce({
      isWayland: true,
      compositor: 'hyprland',
      isOmarchy: true,
      omarchyLuaConfig: true,
    });
    await expect(fetchShortcutBackendInfo()).resolves.toEqual({
      isWayland: true,
      compositor: 'hyprland',
      isOmarchy: true,
      omarchyLuaConfig: true,
    });
  });

  it('falls back to non-Wayland default when IPC throws', async () => {
    getShortcutBackendInfo.mockRejectedValueOnce(new Error('not in tauri'));
    await expect(fetchShortcutBackendInfo()).resolves.toEqual({
      isWayland: false,
      compositor: null,
      isOmarchy: false,
      omarchyLuaConfig: false,
    });
  });
});
