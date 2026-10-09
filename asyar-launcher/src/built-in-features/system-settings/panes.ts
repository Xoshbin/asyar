import type { Platform } from '@tauri-apps/plugin-os';
import { t } from '../../services/i18n';

/**
 * Pane ids are platform-neutral (`sound`, `displays`, …): they are the
 * dynamic command ids and double as i18n keys under
 * `features.system_settings.panes`, so another platform's table can reuse
 * them with its own `bundleId`.
 */
export interface SettingsPaneSpec {
  id: string;
  /** ExtensionKit bundle id of the pane (`/System/Library/ExtensionKit/Extensions/*.appex`). */
  bundleId: string;
  icon: string;
}

/**
 * macOS System Settings panes (macOS 13+). Rust opens each through the
 * `x-apple.systempreferences:<bundleId>` URL scheme and only accepts ids
 * listed in `MACOS_SETTINGS_PANE_IDS` (`commands/settings_panes.rs`);
 * panes missing on an older or newer macOS simply open System Settings at
 * its default page.
 */
const MACOS_SETTINGS_PANES: readonly SettingsPaneSpec[] = [
  { id: 'wifi', bundleId: 'com.apple.wifi-settings-extension', icon: 'icon:globe' },
  { id: 'bluetooth', bundleId: 'com.apple.BluetoothSettings', icon: 'icon:activity' },
  { id: 'network', bundleId: 'com.apple.Network-Settings.extension', icon: 'icon:globe' },
  {
    id: 'notifications',
    bundleId: 'com.apple.Notifications-Settings.extension',
    icon: 'icon:info',
  },
  { id: 'sound', bundleId: 'com.apple.Sound-Settings.extension', icon: 'icon:sliders' },
  { id: 'focus', bundleId: 'com.apple.Focus-Settings.extension', icon: 'icon:moon' },
  { id: 'screen_time', bundleId: 'com.apple.Screen-Time-Settings.extension', icon: 'icon:history' },
  { id: 'general', bundleId: 'com.apple.systempreferences.GeneralSettings', icon: 'icon:settings' },
  { id: 'about', bundleId: 'com.apple.SystemProfiler.AboutExtension', icon: 'icon:info' },
  {
    id: 'software_update',
    bundleId: 'com.apple.Software-Update-Settings.extension',
    icon: 'icon:arrow-up-circle',
  },
  { id: 'storage', bundleId: 'com.apple.settings.Storage', icon: 'icon:folder' },
  { id: 'appearance', bundleId: 'com.apple.Appearance-Settings.extension', icon: 'icon:palette' },
  {
    id: 'accessibility',
    bundleId: 'com.apple.Accessibility-Settings.extension',
    icon: 'icon:user',
  },
  {
    id: 'control_center',
    bundleId: 'com.apple.ControlCenter-Settings.extension',
    icon: 'icon:sliders',
  },
  { id: 'siri', bundleId: 'com.apple.Siri-Settings.extension', icon: 'icon:sparkles' },
  { id: 'spotlight', bundleId: 'com.apple.Spotlight-Settings.extension', icon: 'icon:search' },
  {
    id: 'privacy_security',
    bundleId: 'com.apple.settings.PrivacySecurity.extension',
    icon: 'icon:lock',
  },
  { id: 'desktop_dock', bundleId: 'com.apple.Desktop-Settings.extension', icon: 'icon:window' },
  { id: 'displays', bundleId: 'com.apple.Displays-Settings.extension', icon: 'icon:window' },
  { id: 'wallpaper', bundleId: 'com.apple.Wallpaper-Settings.extension', icon: 'icon:image' },
  { id: 'battery', bundleId: 'com.apple.Battery-Settings.extension', icon: 'icon:power' },
  { id: 'lock_screen', bundleId: 'com.apple.Lock-Screen-Settings.extension', icon: 'icon:lock' },
  { id: 'touch_id', bundleId: 'com.apple.Touch-ID-Settings.extension', icon: 'icon:lock' },
  { id: 'users_groups', bundleId: 'com.apple.Users-Groups-Settings.extension', icon: 'icon:user' },
  {
    id: 'internet_accounts',
    bundleId: 'com.apple.Internet-Accounts-Settings.extension',
    icon: 'icon:user',
  },
  { id: 'keyboard', bundleId: 'com.apple.Keyboard-Settings.extension', icon: 'icon:keyboard' },
  { id: 'trackpad', bundleId: 'com.apple.Trackpad-Settings.extension', icon: 'icon:settings' },
  { id: 'mouse', bundleId: 'com.apple.Mouse-Settings.extension', icon: 'icon:settings' },
  {
    id: 'printers_scanners',
    bundleId: 'com.apple.Print-Scan-Settings.extension',
    icon: 'icon:file-text',
  },
  { id: 'date_time', bundleId: 'com.apple.Date-Time-Settings.extension', icon: 'icon:history' },
  {
    id: 'language_region',
    bundleId: 'com.apple.Localization-Settings.extension',
    icon: 'icon:globe',
  },
  { id: 'sharing', bundleId: 'com.apple.Sharing-Settings.extension', icon: 'icon:link' },
  {
    id: 'airdrop_handoff',
    bundleId: 'com.apple.AirDrop-Handoff-Settings.extension',
    icon: 'icon:download',
  },
  { id: 'login_items', bundleId: 'com.apple.LoginItems-Settings.extension', icon: 'icon:power' },
  {
    id: 'time_machine',
    bundleId: 'com.apple.Time-Machine-Settings.extension',
    icon: 'icon:history',
  },
  {
    id: 'startup_disk',
    bundleId: 'com.apple.Startup-Disk-Settings.extension',
    icon: 'icon:folder',
  },
];

/** The single place that picks the pane table for a platform. */
export function settingsPanesFor(os: Platform): readonly SettingsPaneSpec[] {
  return os === 'macos' ? MACOS_SETTINGS_PANES : [];
}

export function settingsPaneName(pane: SettingsPaneSpec): string {
  return t(`features.system_settings.panes.${pane.id}`);
}

export function findSettingsPane(os: Platform, id: string): SettingsPaneSpec | undefined {
  return settingsPanesFor(os).find((pane) => pane.id === id);
}
