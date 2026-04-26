import type { ExtensionManifest } from 'asyar-sdk/contracts';
import type { CompatibilityStatus } from './CompatibilityStatus';

export interface ExtensionRecord {
  manifest: ExtensionManifest;
  enabled: boolean;
  isBuiltIn: boolean;
  path: string;
  compatibility?: CompatibilityStatus;
  firstViewComponent?: string | null;
}
