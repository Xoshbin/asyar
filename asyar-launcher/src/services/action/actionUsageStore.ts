const STORAGE_KEY = 'asyar:action:usage'

export class ActionUsageStore {
  private counts: Record<string, number>

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      this.counts = raw ? (JSON.parse(raw) as Record<string, number>) : {}
    } catch {
      this.counts = {}
    }
  }

  getCount(actionId: string): number {
    return this.counts[actionId] ?? 0
  }

  record(actionId: string): void {
    this.counts[actionId] = (this.counts[actionId] ?? 0) + 1
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.counts))
    } catch {
      // storage quota exceeded — degrade gracefully
    }
  }

  sortByUsage<T extends { id: string }>(actions: T[]): T[] {
    return [...actions].sort((a, b) => this.getCount(b.id) - this.getCount(a.id))
  }
}

export const actionUsageStore = new ActionUsageStore()
