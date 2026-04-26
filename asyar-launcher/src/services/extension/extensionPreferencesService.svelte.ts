import {
  extensionPreferencesGetAll,
  extensionPreferencesSet,
  extensionPreferencesReset,
} from '../../lib/ipc/commands';
import type { PreferenceDeclaration } from 'asyar-sdk/contracts';
import { extensionIframeManager } from './extensionIframeManager.svelte';

export interface PreferenceBundle {
  extension: Record<string, any>;
  commands: Record<string, Record<string, any>>;
}

export interface ManifestDeclarations {
  extension: PreferenceDeclaration[];
  commands: Record<string, PreferenceDeclaration[]>;
}

class ExtensionPreferencesService {
  private declarations = new Map<string, ManifestDeclarations>();
  private cache = new Map<string, PreferenceBundle>();

  /**
   * Register an extension's preference declarations from its manifest.
   * This is called by ExtensionManager during extension discovery.
   */
  registerManifest(extensionId: string, decls: ManifestDeclarations) {
    this.declarations.set(extensionId, decls);
    // Invalidate cache when manifest changes
    this.cache.delete(extensionId);
  }

  /**
   * Returns the registered declarations for an extension, or undefined if
   * the extension has not registered any preferences. Used by the prompt
   * host to determine whether a given preference lives at the extension
   * level or is scoped to a command.
   */
  getDeclarations(extensionId: string): ManifestDeclarations | undefined {
    return this.declarations.get(extensionId);
  }

  /**
   * Resolves effective preferences for an extension (stored values + defaults).
   */
  async getEffectivePreferences(extensionId: string): Promise<PreferenceBundle> {
    const cached = this.cache.get(extensionId);
    if (cached) return cached;

    const decls = this.declarations.get(extensionId);
    if (!decls) {
      return { extension: {}, commands: {} };
    }

    const stored = await extensionPreferencesGetAll(extensionId);

    const bundle: PreferenceBundle = {
      extension: {},
      commands: {},
    };

    // 1. Extension-level preferences
    for (const decl of decls.extension) {
      const row = stored.find((r) => r.commandId === null && r.key === decl.name);
      if (row) {
        bundle.extension[decl.name] = JSON.parse(row.value);
      } else if (decl.default !== undefined) {
        bundle.extension[decl.name] = decl.default;
      }
    }

    // 2. Command-level preferences
    for (const [commandId, commandDecls] of Object.entries(decls.commands)) {
      bundle.commands[commandId] = {};
      for (const decl of commandDecls) {
        const row = stored.find((r) => r.commandId === commandId && r.key === decl.name);
        if (row) {
          bundle.commands[commandId][decl.name] = JSON.parse(row.value);
        } else if (decl.default !== undefined) {
          bundle.commands[commandId][decl.name] = decl.default;
        }
      }
    }

    this.cache.set(extensionId, bundle);
    return bundle;
  }

  /**
   * Returns the list of `required: true` preferences that are currently
   * unset for the given command. Checks both extension-level and
   * command-level declarations. An empty return value means the command
   * can execute.
   */
  async getMissingRequired(
    extensionId: string,
    commandId: string
  ): Promise<PreferenceDeclaration[]> {
    const decls = this.declarations.get(extensionId);
    if (!decls) return [];
    const bundle = await this.getEffectivePreferences(extensionId);

    const isEmpty = (v: unknown) => v === undefined || v === null || v === '';
    const missing: PreferenceDeclaration[] = [];

    for (const p of decls.extension) {
      if (p.required && isEmpty(bundle.extension[p.name])) missing.push(p);
    }
    const cmdPrefs = decls.commands[commandId] ?? [];
    for (const p of cmdPrefs) {
      const v = bundle.commands[commandId]?.[p.name];
      if (p.required && isEmpty(v)) missing.push(p);
    }
    return missing;
  }

  /**
   * Persists a preference value. All values go through JSON.stringify
   * uniformly — including password-type values — so the read path can
   * always JSON.parse what Rust returns (after Rust-side decryption for
   * password rows).
   */
  async set(
    extensionId: string,
    commandId: string | null,
    key: string,
    value: any
  ): Promise<void> {
    const decls = this.declarations.get(extensionId);
    if (!decls) throw new Error(`Manifest not registered for ${extensionId}`);

    const list = commandId ? decls.commands[commandId] : decls.extension;
    const decl = list?.find((p) => p.name === key);
    if (!decl) throw new Error(`Preference '${key}' not declared`);

    const isEncrypted = decl.type === 'password';
    await extensionPreferencesSet(
      extensionId,
      commandId,
      key,
      JSON.stringify(value),
      isEncrypted
    );

    await this.pushSnapshotToIframe(extensionId);
  }

  /**
   * Resets preferences for an extension. When `scope` is provided, only
   * preferences in that scope are reset to manifest defaults
   * (`'extension'` for extension-level, or a command id for
   * command-level). When `scope` is omitted, every stored preference for
   * the extension is wiped via the Rust command.
   *
   * The Rust-emitted `asyar:preferences-changed` event still fires from
   * the wipe-all path and keeps other webview windows (e.g. the settings
   * window) in sync.
   */
  async reset(extensionId: string, scope?: string): Promise<void> {
    if (scope === undefined) {
      await extensionPreferencesReset(extensionId);
      await this.pushSnapshotToIframe(extensionId);
      return;
    }

    const decls = this.declarations.get(extensionId);
    if (!decls) {
      throw new Error(`No declarations registered for extension "${extensionId}"`);
    }

    const group =
      scope === 'extension' ? decls.extension : decls.commands?.[scope];

    if (!group) {
      const known = ['extension', ...Object.keys(decls.commands ?? {})];
      throw new Error(
        `Unknown scope "${scope}" for extension "${extensionId}". Known scopes: ${known.join(', ')}`
      );
    }

    const commandId = scope === 'extension' ? null : scope;
    for (const decl of group) {
      await this.set(extensionId, commandId, decl.name, decl.default);
    }
    await this.pushSnapshotToIframe(extensionId);
  }

  /**
   * Push the current effective preferences snapshot to the extension's
   * iframe. Called synchronously after every mutation so the iframe sees
   * fresh values without waiting for Rust's `asyar:preferences-changed`
   * event to round-trip. The cache is dropped first so the snapshot is
   * read fresh.
   */
  private async pushSnapshotToIframe(extensionId: string): Promise<void> {
    this.cache.delete(extensionId);
    const fresh = await this.getEffectivePreferences(extensionId);
    extensionIframeManager.sendPreferencesToExtension(extensionId, fresh);
  }

  /**
   * Drop the cached bundle for one extension so the next
   * `getEffectivePreferences` re-reads from Rust. Called by the
   * extensionManager when it receives an `asyar:preferences-changed`
   * Tauri event from the Rust side.
   */
  invalidateCache(extensionId: string): void {
    this.cache.delete(extensionId);
  }

  /**
   * Internal helper for testing to clear state.
   */
  _resetForTesting() {
    this.declarations.clear();
    this.cache.clear();
  }
}

export const extensionPreferencesService = new ExtensionPreferencesService();
