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
