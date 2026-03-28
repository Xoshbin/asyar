import type { ExtensionManifest } from 'asyar-sdk';

export interface ExtensionRecord {
  manifest: ExtensionManifest;
  enabled: boolean;
  isBuiltIn: boolean;
  path: string;
}
