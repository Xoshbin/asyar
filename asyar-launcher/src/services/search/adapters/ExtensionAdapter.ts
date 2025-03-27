import type { SearchDocument } from "../interfaces/SearchDocument";
import type { Command } from "../types/Command";

export class ExtensionAdapter {
  toSearchDocument(item: Command): SearchDocument {
    console.log(`Adapting Command: ${item.name}`);
    return {
      // Use the command's ID for the objectID
      objectID: `ext_${item.id}`,
      name: item.name,
      type: "command", // Set the type field
      content: `${item.name} ${item.extension} ${item.trigger} ${item.type}`, // Combine
    };
  }
}
