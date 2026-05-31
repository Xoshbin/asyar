import { invoke } from '@tauri-apps/api/core';

export interface CreatedExtension {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string | null;
  path: string;
}

export function listCreatedExtensions(): Promise<CreatedExtension[]> {
  return invoke('list_created_extensions');
}

// Filtering lives in Rust (rust-first): the view sends the query and renders the
// returned subset verbatim. An empty query returns every created extension.
export function searchCreatedExtensions(query: string): Promise<CreatedExtension[]> {
  return invoke('search_created_extensions', { query });
}
