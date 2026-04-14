import { getVersion } from '@tauri-apps/api/app';
import { emit } from '@tauri-apps/api/event';
import { profileService } from '../../../services/profile/profileService';
import { envService } from '../../../services/envService';
import { registerProfileProviders } from '../../../services/appInitializer';
import type {
  ISyncProvider,
  DataSummary,
  ImportPreview,
  ConflictStrategy,
  ArchiveManifest,
  SyncProviderData,
} from '../../../services/profile/types';
import type { ProfileArchiveContents, ProfileCategoryEntry } from '../../../lib/ipc/commands';
import { logService } from '../../../services/log/logService';
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
    registerProfileProviders(); // no-op if already registered (main window); registers on first call in settings window
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

  async handleChooseFile(): Promise<void> {
    const filePath = await showOpenProfileDialog();
    if (!filePath) return;

    this.importFile = filePath;
    this.importNeedsPassword = false;
    this.importPassword = '';
    this.importStatus = 'idle';
    this.importMessage = '';

    try {
      const contents = await importProfile(filePath, null);
      const manifest: ArchiveManifest = JSON.parse(contents.manifest_json);

      if (manifest.encryptionScheme) {
        this.importNeedsPassword = true;
        this.importManifest = manifest;
        return;
      }

      await this._populatePreview(contents, manifest);
      this.importModalOpen = true;
    } catch (err) {
      this.importStatus = 'error';
      this.importMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async handleFileWithPassword(): Promise<void> {
    this.importStatus = 'importing';
    this.importMessage = '';

    try {
      const contents = await importProfile(this.importFile, this.importPassword);
      const manifest: ArchiveManifest = JSON.parse(contents.manifest_json);
      await this._populatePreview(contents, manifest);
      this.importNeedsPassword = false;
      this.importStatus = 'idle';
      this.importModalOpen = true;
    } catch (err) {
      this.importMessage = err instanceof Error ? err.message : String(err);
      this.importStatus = 'error';
    }
  }

  private async _populatePreview(
    contents: ProfileArchiveContents,
    manifest: ArchiveManifest,
  ): Promise<void> {
    this._importContents = contents;
    this.importManifest = manifest;

    const categories = new Map<string, { enabled: boolean; strategy: ConflictStrategy }>();
    const previewData = new Map<string, ImportPreview>();

    for (const archiveCat of manifest.categories) {
      const provider = profileService.getProviderById(archiveCat.id);
      const strategy = provider?.defaultConflictStrategy ?? 'merge';
      categories.set(archiveCat.id, { enabled: true, strategy });

      if (provider) {
        const rawJson = contents.category_files[archiveCat.file];
        if (rawJson) {
          const providerData: SyncProviderData = JSON.parse(rawJson);
          try {
            const preview = await provider.preview(providerData);
            previewData.set(archiveCat.id, preview);
          } catch {
            // non-fatal — row just won't show counts
          }
        }
      }
    }

    this.importCategories = categories;
    this.importPreviewData = previewData;
  }

  async handleImport(): Promise<void> {
    if (!this.importManifest || !this._importContents) return;

    this.importStatus = 'importing';

    try {
      for (const [catId, catState] of this.importCategories) {
        if (!catState.enabled) continue;

        const provider = profileService.getProviderById(catId);
        if (!provider) {
          logService.warn(`Provider "${catId}" not registered locally — skipping`);
          continue;
        }

        const archiveCat = this.importManifest.categories.find(c => c.id === catId);
        if (!archiveCat) continue;

        const rawJson = this._importContents.category_files[archiveCat.file];
        if (!rawJson) continue;

        const providerData: SyncProviderData = JSON.parse(rawJson);
        await provider.applyImport(providerData, catState.strategy);
      }

      if (envService.isTauri) {
        await emit('asyar:stores-restored');
      }

      this.importModalOpen = false;
      this.importStatus = 'success';
      this.importMessage = 'Backup restored successfully.';
      setTimeout(() => {
        this.importStatus = 'idle';
        this.importMessage = '';
      }, 4000);
    } catch (err) {
      this.importStatus = 'error';
      this.importMessage = err instanceof Error ? err.message : String(err);
    }
  }

  closeImportModal(): void {
    this.importModalOpen = false;
    this.importStatus = 'idle';
    this.importMessage = '';
    this.importFile = '';
    this.importManifest = null;
    this.importCategories = new Map();
    this.importPreviewData = new Map();
    this.importNeedsPassword = false;
    this.importPassword = '';
    this._importContents = null;
  }
}
