interface SuggestionEntry {
  title: string;
  category: string;
  count: number;
  lastUsed: Date;
}

export class SuggestionService {
  private static readonly STORAGE_KEY = "item_suggestions";
  private static readonly MAX_SUGGESTIONS = 10;
  private itemHistory: Map<string, SuggestionEntry>;

  constructor() {
    this.itemHistory = new Map();
    this.loadFromStorage();
  }

  public trackSelection(title: string, category: string): void {
    const key = `${category}:${title}`;
    const existing = this.itemHistory.get(key) || {
      title,
      category,
      count: 0,
      lastUsed: new Date(),
    };

    existing.count++;
    existing.lastUsed = new Date();
    this.itemHistory.set(key, existing);
    this.saveToStorage();
  }

  public getSuggestions(): Array<{ title: string; category: string }> {
    return Array.from(this.itemHistory.values())
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return b.lastUsed.getTime() - a.lastUsed.getTime();
      })
      .slice(0, SuggestionService.MAX_SUGGESTIONS)
      .map(({ title, category }) => ({ title, category }));
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(SuggestionService.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.itemHistory = new Map(
          Object.entries(data).map(([key, value]: [string, any]) => [
            key,
            { ...value, lastUsed: new Date(value.lastUsed) },
          ])
        );
      }
    } catch (error) {
      console.error("Failed to load suggestions:", error);
    }
  }

  private saveToStorage(): void {
    try {
      const data = Object.fromEntries(this.itemHistory);
      localStorage.setItem(SuggestionService.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save suggestions:", error);
    }
  }
}
