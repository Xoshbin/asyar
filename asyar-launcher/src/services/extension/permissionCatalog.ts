/**
 * Human-readable display metadata for manifest permission strings, used by the
 * consent dialog and the read-only permission lists in settings and the store.
 *
 * Descriptions are derived from `docs/reference/permissions.md`. Permission
 * strings not in the catalog (a newer launcher's permission, or a typo in a
 * manifest) render with the raw string and `known: false` so the UI can show a
 * caution note instead of silently pretending to understand them.
 */

export interface PermissionInfo {
  title: string;
  description: string;
}

export const PERMISSION_CATALOG: Record<string, PermissionInfo> = {
  network: {
    title: 'Network access',
    description: 'Make outbound HTTP requests.',
  },
  'notifications:send': {
    title: 'Send notifications',
    description: 'Post notifications to the system notification center.',
  },
  'clipboard:read': {
    title: 'Read clipboard',
    description: 'Read current clipboard content and clipboard history.',
  },
  'clipboard:write': {
    title: 'Write clipboard',
    description: 'Write, paste, and manage clipboard content.',
  },
  'storage:read': {
    title: 'Read extension storage',
    description: "Read from the extension's own key-value store.",
  },
  'storage:write': {
    title: 'Write extension storage',
    description: "Write to the extension's own key-value store.",
  },
  'store:read': {
    title: 'Read extension store data',
    description: "Read from the extension's data store.",
  },
  'store:write': {
    title: 'Write extension store data',
    description: "Write to the extension's data store.",
  },
  'cache:read': {
    title: 'Read extension cache',
    description: "Read from the extension's cache.",
  },
  'cache:write': {
    title: 'Write extension cache',
    description: "Write to the extension's cache.",
  },
  'fs:read': {
    title: 'Reveal files',
    description: 'Show files in the system file manager.',
  },
  'fs:write': {
    title: 'Move files to trash',
    description: 'Move files to the system trash.',
  },
  'fs:watch': {
    title: 'Watch files',
    description: 'Observe filesystem changes under the declared glob patterns.',
  },
  'files:search': {
    title: 'Search local files',
    description: 'Search the local file index (file names and metadata, not file contents).',
  },
  'files:read': {
    title: 'Read file contents',
    description:
      'Read the text contents, list the file names, and render thumbnails of files matching the declared path patterns. Credential stores and OS locations are always excluded.',
  },
  'notes:read': {
    title: 'Search and read your notes',
    description: 'Search your Notes and read the full content of any note.',
  },
  'notes:write': {
    title: 'Create and append to notes',
    description:
      "Create new notes and add text to the end of existing ones. Cannot overwrite or delete a note's existing content.",
  },
  'shell:spawn': {
    title: 'Run programs',
    description: 'Spawn OS processes and read their output. Grants broad system access.',
  },
  'shell:open-url': {
    title: 'Open URLs',
    description:
      'Open web links (http, https, mailto, tel) in the default browser — plus any additional URL schemes the extension declares, which can launch the apps registered for them.',
  },
  'entitlements:read': {
    title: 'Read subscription status',
    description: "Read the user's active subscription entitlements.",
  },
  'selection:read': {
    title: 'Read selection',
    description:
      'Read the currently selected text or file-manager items from the frontmost application.',
  },
  'oauth:use': {
    title: 'Sign in to services',
    description: 'Run OAuth authorization flows with third-party providers.',
  },
  'extension:invoke': {
    title: 'Invoke other extensions',
    description: 'Launch commands in other installed extensions.',
  },
  'application:read': {
    title: 'Read installed apps',
    description: 'List installed applications and query the frontmost or running apps.',
  },
  'window:manage': {
    title: 'Manage windows',
    description:
      'Read and change the position, size, and fullscreen state of the frontmost window.',
  },
  'screen:pick-color': {
    title: 'Pick colors from the screen',
    description: 'Show the OS eyedropper and read the color of a screen pixel the user picks.',
  },
  'power:inhibit': {
    title: 'Keep system awake',
    description: 'Prevent the OS from sleeping while extension logic is running.',
  },
  'process:read': {
    title: 'List processes',
    description: 'List running processes with CPU and memory usage.',
  },
  'process:kill': {
    title: 'Terminate processes',
    description: 'Terminate or force-kill running processes.',
  },
  'systemEvents:read': {
    title: 'Observe system events',
    description: 'Subscribe to OS sleep, wake, lid, battery, and power-source events.',
  },
  'app:frontmost-watch': {
    title: 'Observe app activity',
    description: 'Subscribe to application launched, terminated, and frontmost-changed events.',
  },
  'timers:schedule': {
    title: 'Schedule timers',
    description: 'Schedule persistent one-shot timers that fire even after relaunch.',
  },
  'timers:cancel': {
    title: 'Cancel timers',
    description: 'Cancel previously scheduled timers.',
  },
  'timers:list': {
    title: 'List timers',
    description: 'List scheduled timers.',
  },
  'preferences:read': {
    title: 'Read preferences',
    description: "Read the extension's own preference values.",
  },
  'preferences:write': {
    title: 'Write preferences',
    description: "Change the extension's own preference values.",
  },
  'feedback:announce': {
    title: 'Show rare announcements',
    description: "Request a host-controlled announcement such as What's New.",
  },
  'tools:register': {
    title: 'Register agent tools',
    description: 'Expose tools to the agent runtime for use during tool-calling.',
  },
  'snippets:contribute': {
    title: 'Contribute snippets',
    description:
      'Contribute shortcode expansions to the global keystroke matcher, replacing typed shortcodes in any app.',
  },
  'runs:track': {
    title: 'Track background runs',
    description: "Start and manage long-running work shown in the launcher's runs UI.",
  },
  'browser:tabs.read': {
    title: 'Read browser tabs',
    description: 'List and inspect tabs in the paired browser.',
  },
  'browser:tabs.write': {
    title: 'Control browser tabs',
    description: 'Open, activate, and close tabs in the paired browser.',
  },
  'browser:bookmarks.read': {
    title: 'Read bookmarks',
    description: "Read the paired browser's bookmarks.",
  },
  'browser:history.read': {
    title: 'Read browsing history',
    description: "Search the paired browser's history.",
  },
  'browser:page.read': {
    title: 'Read page content',
    description: 'Read the content of the current page in the paired browser.',
  },
  'browser:page.write': {
    title: 'Act on pages',
    description: 'Interact with page content in the paired browser.',
  },
};

export interface PermissionDisplay extends PermissionInfo {
  /** False when the permission string is not in the catalog. */
  known: boolean;
}

export function describePermission(permission: string): PermissionDisplay {
  const info = PERMISSION_CATALOG[permission];
  if (info) {
    return { ...info, known: true };
  }
  return {
    title: permission,
    description: 'Not recognized by this version of Asyar.',
    known: false,
  };
}
