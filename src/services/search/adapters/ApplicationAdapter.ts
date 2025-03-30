import type { SearchDocument } from "../interfaces/SearchDocument";
import type { Application } from "../types/Application";

export class ApplicationAdapter {
  toSearchDocument(item: Application): SearchDocument {
    console.log(`Adapting Application: ${item.name}`);
    return {
      // Example: create a unique ID (ensure this is stable and unique!)
      objectID: `app_${item.name.replace(/\s+/g, "_").toLowerCase()}`,
      name: item.name,
      type: "application", // Set the type field
      content: `${item.name} ${item.path}`, // Combine searchable text
    };
  }
}
