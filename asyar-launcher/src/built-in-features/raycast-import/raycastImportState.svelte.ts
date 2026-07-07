import { raycastImportParse } from '../../lib/ipc/commands';
import { applyBundle } from './importApplier';
import type { ImportBundle, ImportSelection, ImportSummary } from './types';

export type ImportPhase = 'pick' | 'password' | 'preview' | 'importing' | 'done' | 'error';

/**
 * Wizard state for the Import from Raycast view:
 *
 *   pick ──parse──▶ preview ──runImport──▶ importing ──▶ done
 *     │                ▲  ▲                      │
 *     │                │  └──── backToPreview ───┤
 *     └─▶ password ────┘                    (throws) ──▶ error
 */
export class RaycastImportState {
  phase = $state<ImportPhase>('pick');
  filePath = $state<string | null>(null);
  password = $state('');
  passwordError = $state(false);
  parsing = $state(false);
  bundle = $state<ImportBundle | null>(null);
  selection = $state<ImportSelection>({
    snippets: true,
    portals: true,
    shortcuts: true,
    aliases: true,
  });
  summary = $state<ImportSummary | null>(null);
  errorMessage = $state<string | null>(null);

  reset(): void {
    this.phase = 'pick';
    this.filePath = null;
    this.password = '';
    this.passwordError = false;
    this.parsing = false;
    this.bundle = null;
    this.selection = { snippets: true, portals: true, shortcuts: true, aliases: true };
    this.summary = null;
    this.errorMessage = null;
  }

  async chooseFile(path: string): Promise<void> {
    this.filePath = path;
    this.password = '';
    this.passwordError = false;
    await this.#parse(undefined);
  }

  async submitPassword(): Promise<void> {
    if (!this.password) return;
    await this.#parse(this.password);
  }

  async #parse(password: string | undefined): Promise<void> {
    if (!this.filePath) return;
    this.parsing = true;
    try {
      const outcome = await raycastImportParse(this.filePath, password);
      if (!outcome) {
        // invokeSafe already reported the diagnostic (unreadable/invalid file)
        this.phase = 'pick';
        this.bundle = null;
        return;
      }
      switch (outcome.status) {
        case 'ok':
          this.bundle = outcome.bundle;
          this.phase = 'preview';
          break;
        case 'passwordRequired':
          this.phase = 'password';
          this.passwordError = false;
          break;
        case 'wrongPassword':
          this.phase = 'password';
          this.passwordError = true;
          break;
      }
    } finally {
      this.parsing = false;
    }
  }

  async runImport(): Promise<void> {
    if (!this.bundle) return;
    this.phase = 'importing';
    try {
      this.summary = await applyBundle(this.bundle, { ...this.selection });
      this.phase = 'done';
    } catch (e) {
      // Without this, a thrown/rejected write (e.g. a shortcut/alias IPC
      // call failing) left the wizard stuck on the loading spinner forever
      // with no way back — the launcher appeared "frozen" from the user's
      // perspective even though the rest of the app was fine.
      this.errorMessage = String(e);
      this.phase = 'error';
    }
  }

  /** Recover from an import failure without re-parsing the file. */
  backToPreview(): void {
    this.errorMessage = null;
    this.phase = 'preview';
  }
}

export const raycastImportState = new RaycastImportState();
