export function groupActionsForDisplay<T extends { displayCategory: string }>(
  actions: T[]
): Array<{ category: string; actions: T[] }> {
  const groupMap = new Map<string, T[]>()

  for (const action of actions) {
    const cat = action.displayCategory
    if (!groupMap.has(cat)) {
      groupMap.set(cat, [])
    }
    groupMap.get(cat)!.push(action)
  }

  return Array.from(groupMap.entries()).map(([category, acts]) => ({
    category,
    actions: acts,
  }))
}
