import {
  extensionPreferencesGetAll,
  extensionPreferencesSet,
  extensionPreferencesReset,
} from '../../lib/ipc/commands';
import type { PreferenceDeclaration } from 'asyar-sdk';

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

    // Invalidate cache
    this.cache.delete(extensionId);

    // Broadcast a bare signal — subscribers (extensionManager) re-read the
    // fresh bundle by calling getEffectivePreferences(). Never put the raw
    // `value` in the event detail: for password-type prefs that would leak
    // the plaintext onto a window-level event any page script can observe.
    window.dispatchEvent(
      new CustomEvent('asyar:preferences-changed', {
        detail: { extensionId },
      })
    );
  }

  /**
   * Resets all preferences for an extension to manifest defaults.
   */
  async reset(extensionId: string): Promise<void> {
    await extensionPreferencesReset(extensionId);
    this.cache.delete(extensionId);
    window.dispatchEvent(
      new CustomEvent('asyar:preferences-changed', {
        detail: { extensionId },
      })
    );
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
