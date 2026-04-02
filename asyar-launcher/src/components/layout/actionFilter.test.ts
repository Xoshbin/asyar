import { describe, it, expect, vi } from 'vitest'
import { filterActions } from './actionFilter'
import type { ApplicationAction } from '../../services/action/actionService.svelte'
import { ActionContext } from 'asyar-sdk'

function makeAction(id: string, label: string, description = ''): ApplicationAction {
  return { id, label, description, context: ActionContext.EXTENSION_VIEW, execute: vi.fn() }
}

describe('filterActions', () => {
  it('returns all actions when query is empty', () => {
    const actions = [makeAction('a', 'Copy'), makeAction('b', 'Paste')]
    expect(filterActions(actions, '')).toHaveLength(2)
  })

  it('returns all actions when query is only whitespace', () => {
    const actions = [makeAction('a', 'Copy')]
    expect(filterActions(actions, '   ')).toHaveLength(1)
  })

  it('matches by label (case-insensitive)', () => {
    const actions = [makeAction('a', 'Copy Image'), makeAction('b', 'Paste')]
    expect(filterActions(actions, 'copy')).toEqual([actions[0]])
  })

  it('matches by description (case-insensitive)', () => {
    const actions = [makeAction('a', 'Action', 'Copies the image to clipboard')]
    expect(filterActions(actions, 'clipboard')).toEqual([actions[0]])
  })

  it('returns empty array when nothing matches', () => {
    const actions = [makeAction('a', 'Copy')]
    expect(filterActions(actions, 'zzz')).toHaveLength(0)
  })

  it('trims the query before matching', () => {
    const actions = [makeAction('a', 'Copy')]
    expect(filterActions(actions, '  copy  ')).toHaveLength(1)
  })
})
