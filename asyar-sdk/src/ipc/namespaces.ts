export const NAMESPACES = [
  'log',
  'extensions',
  'notifications',
  'clipboard',
  'commands',
  'actions',
  'settings',
  'preferences',
  'statusBar',
  'entitlements',
  'network',
  'storage',
  'cache',
  'feedback',
  'selection',
  'ai',
  'oauth',
  'opener',
  'power',
  'shell',
  'systemEvents',
  'fs',
  'interop',
  'application',
  'window',
] as const

export type Namespace = typeof NAMESPACES[number]

export type WireCommand = `${Namespace}:${string}`

export function isNamespace(value: string): value is Namespace {
  return (NAMESPACES as readonly string[]).includes(value)
}
