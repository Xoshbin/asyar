import type { SearchBarAccessoryDropdownOption } from 'asyar-sdk/contracts';
import { logService } from '../log/logService';
import { extensionIframeManager } from '../extension/extensionIframeManager.svelte';
import {
  searchbarAccessoryGet,
  searchbarAccessorySet,
} from '../../lib/ipc/searchAccessoryCommands';

export interface SearchBarAccessoryActiveState {
  extensionId: string;
  commandId: string;
  options: SearchBarAccessoryDropdownOption[];
  value: string;
  buttonTitle?: string;
}

export interface DeclareInput {
  extensionId: string;
  commandId: string;
  options: SearchBarAccessoryDropdownOption[];
  default?: string;
  /**
   * The current selection, for an owner whose state lives elsewhere (e.g. the
   * agent a chat view shows). Seeds the dropdown instead of the persisted
   * value, which would otherwise override that state on every mount.
   */
  value?: string;
  buttonTitle?: string;
}

function hasSelectableValue(options: SearchBarAccessoryDropdownOption[], value: string): boolean {
  for (const opt of options) {
    if (opt.children && opt.children.length > 0) {
      if (hasSelectableValue(opt.children, value)) return true;
    } else if (opt.value === value) {
      return true;
    }
  }
  return false;
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
  #seq = 0;

  async declare(input: DeclareInput): Promise<void> {
    if (input.options.length === 0) {
      throw new Error('searchBarAccessory.declare: options cannot be empty');
    }

    const mySeq = ++this.#seq;
    const ownerValue =
      input.value !== undefined && hasSelectableValue(input.options, input.value)
        ? input.value
        : null;

    // A missing row is a successful `null`. A read failure is diagnosed by
    // the transport and deliberately falls back to the manifest default.
    let persisted: string | null = null;
    if (ownerValue === null) {
      try {
        persisted = await searchbarAccessoryGet(input.extensionId, input.commandId);
      } catch {
        // Best-effort persistence read; declaration can still use its default.
      }
      if (mySeq !== this.#seq) return;
    }

    let seed: string;
    if (ownerValue !== null) {
      seed = ownerValue;
    } else if (persisted !== null && hasSelectableValue(input.options, persisted)) {
      seed = persisted;
    } else if (input.default !== undefined && hasSelectableValue(input.options, input.default)) {
      seed = input.default;
    } else {
      seed = input.options[0].value;
    }

    this.active = {
      extensionId: input.extensionId,
      commandId: input.commandId,
      options: input.options,
      value: seed,
      buttonTitle: input.buttonTitle,
    };
    this.broadcast(input.extensionId, input.commandId, seed, /*toView=*/ true);
  }

  /**
   * Synchronize reactive view state (options tree, current value, summary
   * button title) into the active accessory without re-broadcasting or writing
   * to persistence. Used by built-in views whose filter state lives in the
   * search query.
   */
  syncViewState(input: {
    extensionId: string;
    commandId: string;
    options: SearchBarAccessoryDropdownOption[];
    value: string;
    buttonTitle?: string;
  }): void {
    this.#seq++;
    this.active = {
      extensionId: input.extensionId,
      commandId: input.commandId,
      options: input.options,
      value: input.value,
      buttonTitle: input.buttonTitle,
    };
  }

  async setSelected(extensionId: string, commandId: string, value: string): Promise<void> {
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
    if (!hasSelectableValue(this.active.options, value)) {
      throw new Error(`searchBarAccessory.setSelected: value '${value}' not in options`);
    }

    const persisted = await searchbarAccessorySet(extensionId, commandId, value);
    if (!persisted) return;
    this.#seq++;
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
      buttonTitle?: string;
    },
  ): Promise<void> {
    if (!this.active || this.active.extensionId !== extensionId) {
      logService.warn(`[SearchBarAccessory] set ignored: no active accessory for ${extensionId}`);
      return;
    }

    // We need the commandId for both the persistence call and the broadcast.
    // Capture it here so we don't read from `this.active` after we mutate it.
    const commandId = this.active.commandId;

    let nextOptions = this.active.options;
    let nextValue = this.active.value;
    const nextButtonTitle =
      opts.buttonTitle !== undefined ? opts.buttonTitle : this.active.buttonTitle;

    if (opts.options) {
      if (opts.options.length === 0) {
        throw new Error('searchBarAccessory.set: options cannot be empty');
      }
      nextOptions = opts.options;
      // Prefer existing value if still valid, else first option.
      if (!hasSelectableValue(nextOptions, nextValue)) {
        nextValue = nextOptions[0].value;
      }
    }

    if (opts.value !== undefined) {
      if (!hasSelectableValue(nextOptions, opts.value)) {
        throw new Error(`searchBarAccessory.set: value '${opts.value}' not in options`);
      }
      nextValue = opts.value;
    }

    const valueChanged = nextValue !== this.active.value;

    // Persist FIRST so a SQLite failure aborts before in-memory state is
    // updated. Mirrors setSelected()'s order — keeps the two paths
    // consistent and prevents `declare()` after a failed `set` from
    // silently rolling back the user's intent.
    if (valueChanged) {
      const persisted = await searchbarAccessorySet(extensionId, commandId, nextValue);
      if (!persisted) return;
    }

    this.#seq++;
    this.active = {
      ...this.active,
      options: nextOptions,
      value: nextValue,
      buttonTitle: nextButtonTitle,
    };

    this.broadcast(extensionId, commandId, nextValue, /*toView=*/ valueChanged);
  }

  /** Tier 2 IPC entry — routed from `asyar:api:searchBar:clear`. */
  async clearForExtension(extensionId: string): Promise<void> {
    if (this.active && this.active.extensionId === extensionId) {
      this.clear();
    }
  }

  clear(): void {
    this.#seq++;
    this.active = null;
  }

  /**
   * Tier 1 subscription. `handler` fires immediately on subscribe if
   * `active` already matches `(extensionId, commandId)` — call order of
   * `declare` and `subscribe` does not matter.
   */
  subscribe(extensionId: string, commandId: string, handler: (value: string) => void): () => void {
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

  private broadcast(extensionId: string, commandId: string, value: string, toView: boolean): void {
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
