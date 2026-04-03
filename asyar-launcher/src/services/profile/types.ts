// asyar-launcher/src/services/profile/types.ts

export type ConflictStrategy = 'replace' | 'merge' | 'skip';

export interface BinaryAsset {
  id: string;
  filename: string;
  mimeType: string;
  /** Relative path within the ZIP archive (e.g., 'assets/clipboard/img-abc.png') */
  archivePath: string;
}

export interface SyncProviderData {
  providerId: string;
  version: number;           // Schema version for forward/backward compat
  exportedAt: number;        // Timestamp
  data: unknown;             // The actual payload — provider-specific
  binaryAssets?: BinaryAsset[]; // Images, files — only present in exportFull()
}

export interface ImportPreview {
  localCount: number;
  incomingCount: number;
  conflicts: number;         // Items that exist in both with different content
  newItems: number;          // Items only in incoming
  removedItems: number;      // Items only in local (would be lost on 'replace')
}

export interface ImportResult {
  success: boolean;
  itemsAdded: number;
  itemsUpdated: number;
  itemsRemoved: number;
  warnings: string[];        // e.g., "2 sensitive fields were stripped"
}

export interface DataSummary {
  itemCount: number;
  label: string;             // e.g., "20 snippets", "3 portals"
}

export interface ISyncProvider {
  /** Unique identifier: 'settings', 'snippets', 'shortcuts', 'portals', etc. */
  readonly id: string;

  /** Human-readable label for the UI checklist */
  readonly displayName: string;

  /** Icon identifier for the UI */
  readonly icon: string;

  /**
   * Sync tier — controls which cloud subscription level includes this data.
   * 'core' = always synced, 'extended' = premium tier (e.g., chat history).
   * For local import/export, all tiers are available.
   */
  readonly syncTier: 'core' | 'extended';

  /** Whether this category is included by default in "Export All" */
  readonly defaultEnabled: boolean;

  /**
   * Conflict resolution strategy for this data type.
   * 'replace' = settings-like (single truth), 'merge' = collection-like (additive).
   * User can always override in the UI.
   */
  readonly defaultConflictStrategy: 'replace' | 'merge';

  /**
   * Dot-notation paths to fields that contain sensitive data (API keys, tokens).
   * Used by the encryption layer to encrypt these fields specifically,
   * or strip them if no password is provided.
   * Examples: ['apiKey'], ['auth.token'], ['providers.openai.apiKey']
   */
  readonly sensitiveFields: string[];

  /** Export full data (for local .asyar file — may include binary references) */
  exportFull(): Promise<SyncProviderData>;

  /** Export sync-safe data (text-only, for cloud sync — no binary blobs) */
  exportForSync(): Promise<SyncProviderData>;

  /** Preview what an import would do, without applying it */
  preview(incoming: SyncProviderData): Promise<ImportPreview>;

  /** Apply import with the chosen conflict strategy */
  applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult>;

  /** Get current item count (for UI: "You have 20 snippets locally") */
  getLocalSummary(): Promise<DataSummary>;

  /**
   * Migrate data from an older providerVersion to current.
   * Called automatically if the archive's providerVersion < current.
   */
  migrate?(data: unknown, fromVersion: number): Promise<unknown>;
}

export interface ExportOptions {
  /** Which category IDs to include. Empty = all defaultEnabled providers */
  categoryIds?: string[];
  /** Password for encrypting sensitive fields. Null = strip sensitive fields */
  password?: string | null;
  /** 'full' for local .asyar, 'sync' for cloud (text-only, no binary) */
  mode: 'full' | 'sync';
}

export interface ArchiveManifest {
  formatVersion: number;
  appVersion: string;
  exportedAt: number;
  platform: string;
  hostname: string;
  encryptionScheme: string | null;
  encryptionSalt: string | null;
  hasSensitiveData: boolean;
  categories: ArchiveCategory[];
}

export interface ArchiveCategory {
  id: string;
  displayName: string;
  file: string;
  providerVersion: number;
  itemCount: number;
  syncTier: string;
  hasSensitiveFields: boolean;
  sensitiveFieldsHandling?: 'encrypted' | 'stripped';
  hasAssets?: boolean;
}

export interface ProfileInspection {
  manifest: ArchiveManifest;
  previews: Map<string, ImportPreview>;
  hasSensitiveData: boolean;
  requiresPassword: boolean;
}

export interface ImportPlanCategory {
  id: string;
  action: 'import' | 'skip';
  strategy: ConflictStrategy;
}

export interface ImportPlan {
  /** Per-category decisions made by the user in the confirmation UI */
  categories: ImportPlanCategory[];
  password?: string | null;
}

export interface ImportReport {
  success: boolean;
  results: Map<string, ImportResult>;
  /** Categories that were skipped by user choice */
  skipped: string[];
  /** Categories that failed (e.g., migration error, decryption failure) */
  failed: Array<{ id: string; error: string }>;
}

export interface IProfileService {
  registerProvider(provider: ISyncProvider): void;
  getProviders(): ISyncProvider[];
  exportProfile(options: ExportOptions): Promise<string>;
  inspectProfile(filePath: string): Promise<ProfileInspection>;
  importProfile(filePath: string, plan: ImportPlan): Promise<ImportReport>;
}
