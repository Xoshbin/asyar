import { getVersion } from '@tauri-apps/api/app';
import { profileService } from '../../../services/profile/profileService';
import type {
  ISyncProvider,
  DataSummary,
  ImportPreview,
  ConflictStrategy,
  ArchiveManifest,
} from '../../../services/profile/types';
import type { ProfileArchiveContents, ProfileCategoryEntry } from '../../../lib/ipc/commands';
import {
  showSaveProfileDialog,
  showOpenProfileDialog,
  exportProfile,
  importProfile,
} from '../../../lib/ipc/commands';

export class BackupHandler {
  // Shared
  providers = $state<ISyncProvider[]>([]);

  // Export state
  enabledCategories = $state<Set<string>>(new Set());
  localSummaries = $state<Map<string, DataSummary>>(new Map());
  exportPassword = $state('');
  exportStatus = $state<'idle' | 'exporting' | 'success' | 'error'>('idle');
  exportMessage = $state('');

  // Import state
  importModalOpen = $state(false);
  importFile = $state('');
  importManifest = $state<ArchiveManifest | null>(null);
  importPreviewData = $state<Map<string, ImportPreview>>(new Map());
  importCategories = $state<Map<string, { enabled: boolean; strategy: ConflictStrategy }>>(new Map());
  importNeedsPassword = $state(false);
  importPassword = $state('');
  importStatus = $state<'idle' | 'importing' | 'success' | 'error'>('idle');
  importMessage = $state('');

  // Internal — not reactive, only needed at apply-import time
  private _importContents: ProfileArchiveContents | null = null;

  get hasSensitiveData(): boolean {
    return this.providers
      .filter(p => this.enabledCategories.has(p.id))
      .some(p => p.sensitiveFields.length > 0);
  }

  async init(): Promise<void> {
    this.providers = profileService.getProviders();

    const enabled = new Set<string>();
    for (const p of this.providers) {
      if (p.defaultEnabled) enabled.add(p.id);
    }
    this.enabledCategories = enabled;

    const summaries = new Map<string, DataSummary>();
    await Promise.all(
      this.providers.map(async p => {
        try {
          const s = await p.getLocalSummary();
          summaries.set(p.id, s);
        } catch {
          // non-fatal — description stays empty
        }
      }),
    );
    this.localSummaries = summaries;
  }

  toggleCategory(id: string): void {
    const next = new Set(this.enabledCategories);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.enabledCategories = next;
  }

  async handleExport(): Promise<void> {
    const outputPath = await showSaveProfileDialog('asyar-backup.asyar');
    if (!outputPath) return;

    this.exportStatus = 'exporting';
    this.exportMessage = '';

    try {
      const appVersion = await getVersion().catch(() => '');

      const exportData = await profileService.collectExportData({
        mode: 'full',
        categoryIds: [...this.enabledCategories],
      });

      const manifest: ArchiveManifest = {
        ...profileService.buildManifest(exportData, this.exportPassword || null),
        appVersion,
        platform: '',
        hostname: '',
      };

      const categories: ProfileCategoryEntry[] = [];
      for (const [providerId, providerData] of exportData) {
        const provider = profileService.getProviderById(providerId);
        categories.push({
          filename: `${providerId}.json`,
          json_content: JSON.stringify(providerData),
          sensitive_field_paths: provider?.sensitiveFields ?? [],
        });
      }

      await exportProfile(
        JSON.stringify(manifest),
        categories,
        [], // binary assets not included in v1
        this.exportPassword || null,
        outputPath,
      );

      this.exportStatus = 'success';
      this.exportMessage = 'Backup saved successfully.';
      setTimeout(() => {
        this.exportStatus = 'idle';
        this.exportMessage = '';
      }, 4000);
    } catch (err) {
      this.exportStatus = 'error';
      this.exportMessage = err instanceof Error ? err.message : String(err);
    }
  }
}
