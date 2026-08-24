export const NAMESPACES = [
  'log',
  'extensions',
  'clipboard',
  'commands',
  'actions',
  'settings',
  'preferences',
  'searchBar',
  'statusBar',
  'entitlements',
  'network',
  'storage',
  'cache',
  'feedback',
  'selection',
  'oauth',
  'opener',
  'power',
  'process',
  'shell',
  'systemEvents',
  'appEvents',
  'applicationIndex',
  'fs',
  'interop',
  'application',
  'window',
  'timers',
  'fsWatcher',
  'state',
  'onboarding',
  'runs',
  'tools',
  'snippets',
  'browser',
  'search',
  'files',
  'screen',
  'notes',
  'environment',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export type WireCommand = `${Namespace}:${string}`;

export function isNamespace(value: string): value is Namespace {
  return (NAMESPACES as readonly string[]).includes(value);
}
