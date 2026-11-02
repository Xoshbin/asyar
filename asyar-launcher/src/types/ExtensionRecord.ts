import type { ExtendedManifest } from './ExtendedManifest';
import type { CompatibilityStatus } from './CompatibilityStatus';

export interface ExtensionRecord {
  manifest: ExtendedManifest;
  enabled: boolean;
  isBuiltIn: boolean;
  disableable?: boolean;
  path: string;
  compatibility?: CompatibilityStatus;
  firstViewComponent?: string | null;
}
