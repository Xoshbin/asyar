import type { ApplicationAction } from '../../services/action/actionService.svelte'

export function filterActions<T extends ApplicationAction>(actions: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return actions
  return actions.filter(a =>
    a.label.toLowerCase().includes(q) ||
    (a.description?.toLowerCase().includes(q) ?? false)
  )
}
