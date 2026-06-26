import {
  listCreatedExtensions as listCreatedExtensionsCommand,
  searchCreatedExtensions as searchCreatedExtensionsCommand,
  type CreatedExtension,
} from '../../../lib/ipc/extensionBuilderCommands';

export type { CreatedExtension };

export async function listCreatedExtensions(): Promise<CreatedExtension[]> {
  return (await listCreatedExtensionsCommand()) ?? [];
}

// Filtering lives in Rust (rust-first): the view sends the query and renders the
// returned subset verbatim. An empty query returns every created extension.
export async function searchCreatedExtensions(query: string): Promise<CreatedExtension[]> {
  return (await searchCreatedExtensionsCommand(query)) ?? [];
}
