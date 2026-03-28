import type { ExtensionManifest } from 'asyar-sdk';
import type { CompatibilityStatus } from './CompatibilityStatus';

export interface ExtensionRecord {
  manifest: ExtensionManifest;
  enabled: boolean;
  isBuiltIn: boolean;
  path: string;
  compatibility?: CompatibilityStatus;
}
