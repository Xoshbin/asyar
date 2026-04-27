import { invoke } from '@tauri-apps/api/core';
import type { SearchBarAccessoryDropdownOption } from 'asyar-sdk/contracts';
import { envService } from '../envService';
import { logService } from '../log/logService';
import { extensionIframeManager } from '../extension/extensionIframeManager.svelte';

export interface SearchBarAccessoryActiveState {
  extensionId: string;
  commandId: string;
  options: SearchBarAccessoryDropdownOption[];
  value: string;
}

export interface DeclareInput {
  extensionId: string;
  commandId: string;
  options: SearchBarAccessoryDropdownOption[];
  default?: string;
}

type Subscriber = {
  extensionId: string;
  commandId: string;
  handler: (value: string) => void;
};

/**
 * Owns the launcher-chrome searchbar accessory dropdown's active state
 * for the current view. Tier 1 built-ins import the singleton directly;
 * Tier 2 extensions reach `set()` / `clearForExtension()` through the IPC
 * router (the proxy from `asyar-sdk/view`).
 *
 * Persistence lives in Rust SQLite (`searchbar_accessory_get|set` Tauri
 * commands); this service is the in-memory cache of the active row plus
 * the local subscriber registry that fans out value changes to consumers.
 */
export class SearchBarAccessoryServiceClass {
  active = $state<SearchBarAccessoryActiveState | null>(null);
  /**
   * True while the dropdown popover is rendered. The launcher's global
   * keydown chain registers on `window` with `{ capture: true }` at page
   * mount, so any per-popover capture-phase listener registered later
   * cannot beat it (DOM listeners on the same target+phase fire in
   * registration order). Tracking popover state on this singleton lets
   * `handleGlobalKeydown` early-bail for navigation keys while the popover
   * is open, so Escape/Arrow/Enter/Tab reach the popover's own handler
   * instead of being intercepted (e.g. Escape navigating the launcher
   * back instead of just closing the popover).
   */
  popoverOpen = $state(false);
  private subscribers = new Set<Subscriber>();

  async declare(input: DeclareInput): Promise<void> {
    if (input.options.length === 0) {
      throw new Error('searchBarAccessory.declare: options cannot be empty');
    }

    let persisted: string | null = null;
    if (envService.isTauri) {
      try {
        const got = await invoke<string | null>('searchbar_accessory_get', {
          extensionId: input.extensionId,
          commandId: input.commandId,
        });
        persisted = got ?? null;
      } catch (e) {
        logService.warn(`[SearchBarAccessory] get failed: ${e}`);
      }
    }

    const optionValues = new Set(input.options.map((o) => o.value));
    let seed: string;
    if (persisted !== null && optionValues.has(persisted)) {
      seed = persisted;
    } else if (input.default !== undefined && optionValues.has(input.default)) {
      seed = input.default;
    } else {
      seed = input.options[0].value;
    }

    this.active = {
      extensionId: input.extensionId,
      commandId: input.commandId,
      options: input.options,
      value: seed,
    };
    this.broadcast(input.extensionId, input.commandId, seed, /*toView=*/ true);
  }

  async setSelected(
    extensionId: string,
    commandId: string,
    value: string,
  ): Promise<void> {
    if (
      !this.active ||
      this.active.extensionId !== extensionId ||
      this.active.commandId !== commandId
    ) {
      logService.warn(
        `[SearchBarAccessory] setSelected ignored: active=${this.active?.extensionId}/${this.active?.commandId}, requested=${extensionId}/${commandId}`,
      );
      return;
    }
    if (!this.active.options.some((o) => o.value === value)) {
      throw new Error(
        `searchBarAccessory.setSelected: value '${value}' not in options`,
      );
    }

    if (envService.isTauri) {
      await invoke('searchbar_accessory_set', {
        extensionId,
        commandId,
        value,
      });
    }
    this.active = { ...this.active, value };
    this.broadcast(extensionId, commandId, value, /*toView=*/ true);
  }

  /**
   * Tier 2 IPC entry — `extensionId` is injected by the router. Routed
   * from `asyar:api:searchBar:set`. Updates options and/or value if the
   * calling extension owns the active accessory; otherwise no-op.
   */
  async set(
    extensionId: string,
    opts: {
      options?: SearchBarAccessoryDropdownOption[];
      value?: string;
    },
  ): Promise<void> {
    if (!this.active || this.active.extensionId !== extensionId) {
      logService.warn(
        `[SearchBarAccessory] set ignored: no active accessory for ${extensionId}`,
      );
      return;
    }

    // We need the commandId for both the persistence call and the broadcast.
    // Capture it here so we don't read from `this.active` after we mutate it.
    const commandId = this.active.commandId;

    let nextOptions = this.active.options;
    let nextValue = this.active.value;

    if (opts.options) {
      if (opts.options.length === 0) {
        throw new Error('searchBarAccessory.set: options cannot be empty');
      }
      nextOptions = opts.options;
      // Prefer existing value if still valid, else first option.
      if (!nextOptions.some((o) => o.value === nextValue)) {
        nextValue = nextOptions[0].value;
      }
    }

    if (opts.value !== undefined) {
      if (!nextOptions.some((o) => o.value === opts.value)) {
        throw new Error(
          `searchBarAccessory.set: value '${opts.value}' not in options`,
        );
      }
      nextValue = opts.value;
    }

    const valueChanged = nextValue !== this.active.value;

    // Persist FIRST so a SQLite failure aborts before in-memory state is
    // updated. Mirrors setSelected()'s order — keeps the two paths
    // consistent and prevents `declare()` after a failed `set` from
    // silently rolling back the user's intent.
    if (valueChanged && envService.isTauri) {
      await invoke('searchbar_accessory_set', {
        extensionId,
        commandId,
        value: nextValue,
      });
    }

    this.active = {
      ...this.active,
      options: nextOptions,
      value: nextValue,
    };

    this.broadcast(
      extensionId,
      commandId,
      nextValue,
      /*toView=*/ valueChanged,
    );
  }

  /** Tier 2 IPC entry — routed from `asyar:api:searchBar:clear`. */
  async clearForExtension(extensionId: string): Promise<void> {
    if (this.active && this.active.extensionId === extensionId) {
      this.clear();
    }
  }

  clear(): void {
    this.active = null;
  }

  /**
   * Tier 1 subscription. `handler` fires immediately on subscribe if
   * `active` already matches `(extensionId, commandId)` — call order of
   * `declare` and `subscribe` does not matter.
   */
  subscribe(
    extensionId: string,
    commandId: string,
    handler: (value: string) => void,
  ): () => void {
    const sub: Subscriber = { extensionId, commandId, handler };
    this.subscribers.add(sub);
    if (
      this.active &&
      this.active.extensionId === extensionId &&
      this.active.commandId === commandId
    ) {
      handler(this.active.value);
    }
    return () => {
      this.subscribers.delete(sub);
    };
  }

  private broadcast(
    extensionId: string,
    commandId: string,
    value: string,
    toView: boolean,
  ): void {
    for (const s of this.subscribers) {
      if (s.extensionId === extensionId && s.commandId === commandId) {
        try {
          s.handler(value);
        } catch (e) {
          logService.warn(`[SearchBarAccessory] subscriber threw: ${e}`);
        }
      }
    }
    if (toView) {
      try {
        extensionIframeManager.sendFilterChangeToView(extensionId, {
          commandId,
          value,
        });
      } catch (e) {
        logService.debug(`[SearchBarAccessory] sendFilterChangeToView: ${e}`);
      }
    }
  }
}

export const searchBarAccessoryService = new SearchBarAccessoryServiceClass();
