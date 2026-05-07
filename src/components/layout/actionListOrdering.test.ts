import { describe, it, expect, vi, beforeEach } from 'vitest'

// No external deps to mock for a pure function, but follow the skill pattern
beforeEach(() => vi.clearAllMocks())

// Import AFTER any mocks (none needed here, but keeping canonical ordering)
import { groupActionsForDisplay } from './actionListOrdering'

interface MinimalAction {
  id: string
  displayCategory: string
}

describe('groupActionsForDisplay', () => {
  it('returns groups in the order their categories first appear', () => {
    const actions: MinimalAction[] = [
      { id: 'a1', displayCategory: 'Clipboard' },
      { id: 'b1', displayCategory: 'System' },
      { id: 'a2', displayCategory: 'Clipboard' },
    ]

    const groups = groupActionsForDisplay(actions)

    expect(groups.map((g) => g.category)).toEqual(['Clipboard', 'System'])
  })

  it('within each group, items appear in declared order (no sort)', () => {
    const actions: MinimalAction[] = [
      { id: 'z', displayCategory: 'Actions' },
      { id: 'a', displayCategory: 'Actions' },
      { id: 'm', displayCategory: 'Actions' },
    ]

    const groups = groupActionsForDisplay(actions)

    expect(groups).toHaveLength(1)
    expect(groups[0].actions.map((a) => a.id)).toEqual(['z', 'a', 'm'])
  })

  it('returns an empty array for empty input', () => {
    const groups = groupActionsForDisplay([])
    expect(groups).toEqual([])
  })

  it('handles a single action correctly (one group, one item)', () => {
    const actions: MinimalAction[] = [{ id: 'solo', displayCategory: 'Misc' }]

    const groups = groupActionsForDisplay(actions)

    expect(groups).toHaveLength(1)
    expect(groups[0].category).toBe('Misc')
    expect(groups[0].actions).toHaveLength(1)
    expect(groups[0].actions[0].id).toBe('solo')
  })

  it('critical regression: two actions in same group declared [A, B] remain [A, B] regardless of any external state', () => {
    // This pins "no hotness sorting" — the order must be declaration order only
    const actions: MinimalAction[] = [
      { id: 'A', displayCategory: 'Tools' },
      { id: 'B', displayCategory: 'Tools' },
    ]

    const groups = groupActionsForDisplay(actions)

    expect(groups).toHaveLength(1)
    expect(groups[0].actions.map((a) => a.id)).toEqual(['A', 'B'])
    // Call again to confirm determinism (no localStorage / usage state involved)
    const groups2 = groupActionsForDisplay(actions)
    expect(groups2[0].actions.map((a) => a.id)).toEqual(['A', 'B'])
  })
})
