import {
  getShortcutBackendInfo,
  type ShortcutBackendInfo,
} from '../../../lib/ipc/shortcutCommands';
import { updateShortcut } from '../../../utils/shortcutManager';

export interface WaylandBindingGuide {
  compositorLabel: string;
  configPath: string | null;
  command: string;
  shortcutDisplay: string;
  isOmarchy: boolean;
}

export async function saveHotkey(detail: {
  modifier: string;
  key: string;
}): Promise<string | true> {
  const success = await updateShortcut(detail.modifier, detail.key);
  return success ? true : 'Could not set that shortcut';
}

export async function fetchShortcutBackendInfo(): Promise<ShortcutBackendInfo> {
  try {
    return await getShortcutBackendInfo();
  } catch {
    return {
      isWayland: false,
      compositor: null,
      isOmarchy: false,
      omarchyLuaConfig: false,
    };
  }
}

export function getWaylandBindingGuide(
  info: ShortcutBackendInfo | null | undefined,
): WaylandBindingGuide | null {
  if (!info?.isWayland) {
    return null;
  }

  switch (info.compositor) {
    case 'hyprland':
      if (info.isOmarchy) {
        if (info.omarchyLuaConfig) {
          return {
            compositorLabel: 'Hyprland (Omarchy)',
            configPath: '~/.config/hypr/bindings.lua',
            command: 'hl.unbind("SUPER + SPACE")\no.bind("SUPER + SPACE", "Asyar", "asyar-summon")',
            shortcutDisplay: 'Super+Space',
            isOmarchy: true,
          };
        }
        return {
          compositorLabel: 'Hyprland (Omarchy)',
          configPath: '~/.config/hypr/bindings.conf',
          command: 'unbind = SUPER, SPACE\nbindd = SUPER, SPACE, Asyar, exec, asyar-summon',
          shortcutDisplay: 'Super+Space',
          isOmarchy: true,
        };
      }
      return {
        compositorLabel: 'Hyprland',
        configPath: '~/.config/hypr/hyprland.conf',
        command: 'bind = $mainMod, SPACE, exec, asyar-summon',
        shortcutDisplay: 'Super+Space',
        isOmarchy: false,
      };
    case 'sway':
      return {
        compositorLabel: 'Sway',
        configPath: '~/.config/sway/config',
        command: 'bindsym $mod+space exec asyar-summon',
        shortcutDisplay: 'Super+Space',
        isOmarchy: false,
      };
    case 'kde':
      return {
        compositorLabel: 'KDE Plasma',
        configPath: null,
        command: 'asyar-summon',
        shortcutDisplay: 'asyar-summon',
        isOmarchy: false,
      };
    case 'gnome':
      return {
        compositorLabel: 'GNOME',
        configPath: null,
        command: 'asyar-summon',
        shortcutDisplay: 'asyar-summon',
        isOmarchy: false,
      };
    default:
      return {
        compositorLabel: 'Wayland',
        configPath: null,
        command: 'asyar-summon',
        shortcutDisplay: 'asyar-summon',
        isOmarchy: false,
      };
  }
}
