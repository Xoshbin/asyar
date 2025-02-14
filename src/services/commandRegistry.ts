import { SearchResultItem } from "../types";

class CommandRegistry {
  private commands: Map<string, SearchResultItem> = new Map();

  registerCommand(extensionId: string, command: SearchResultItem): void {
    const commandId = `${extensionId}.${command.id}`;
    this.commands.set(commandId, command);
  }

  unregisterExtension(extensionId: string): void {
    for (const commandId of this.commands.keys()) {
      if (commandId.startsWith(`${extensionId}.`)) {
        this.commands.delete(commandId);
      }
    }
  }

  getCommand(commandId: string): SearchResultItem | undefined {
    return this.commands.get(commandId);
  }

  searchCommands(query: string): SearchResultItem[] {
    const results: SearchResultItem[] = [];
    const searchTerm = query.toLowerCase();

    for (const command of this.commands.values()) {
      const titleMatch = command.title.toLowerCase().includes(searchTerm);
      const subtitleMatch = command.subtitle
        ?.toLowerCase()
        .includes(searchTerm);
      const idMatch = command.id.toLowerCase().includes(searchTerm);

      if (titleMatch || subtitleMatch || idMatch) {
        let score = 0;
        if (titleMatch)
          score += command.title.toLowerCase().startsWith(searchTerm) ? 2 : 1;
        if (subtitleMatch) score += 0.5;
        if (idMatch) score += 0.3;

        results.push({
          ...command,
          score,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  getAllCommands(): SearchResultItem[] {
    return Array.from(this.commands.values());
  }
}

export const commandRegistry = new CommandRegistry();
