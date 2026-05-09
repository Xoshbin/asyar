export const NAMESPACES = [
  'log',
  'extensions',
  'notifications',
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
  'diagnostics',
  'selection',
  'ai',
  'oauth',
  'opener',
  'power',
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
] as const

export type Namespace = typeof NAMESPACES[number]

export type WireCommand = `${Namespace}:${string}`

export function isNamespace(value: string): value is Namespace {
  return (NAMESPACES as readonly string[]).includes(value)
}
