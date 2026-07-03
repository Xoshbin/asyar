// Wire types for the `raycast_import_parse` Tauri command
// (see src-tauri/src/raycast_import/mod.rs — serde camelCase).

export type SourceFormat =
  | 'rayconfigX'
  | 'rayconfigClassic'
  | 'snippetsJson'
  | 'quicklinksJson';

export interface ImportSnippet {
  name: string;
  keyword?: string;
  expansion: string;
  pinned: boolean;
  createdAt?: number;
}

export interface ImportPortal {
  raycastId?: string;
  name: string;
  url: string;
  icon: string;
}

export type ShortcutTarget =
  | {
      kind: 'app';
      path: string;
      objectId?: string;
      itemName?: string;
      itemIcon?: string;
    }
  | { kind: 'portal'; raycastQuicklinkId: string };

export interface ImportShortcut {
  target: ShortcutTarget;
  shortcut: string;
}

export interface ImportAlias {
  target: ShortcutTarget;
  alias: string;
}

export interface SkippedCounts {
  hotkeys: number;
  aliases: number;
}

export interface ImportBundle {
  source: SourceFormat;
  snippets: ImportSnippet[];
  portals: ImportPortal[];
  shortcuts: ImportShortcut[];
  aliases: ImportAlias[];
  skipped: SkippedCounts;
}

export type ParseOutcome =
  | { status: 'ok'; bundle: ImportBundle }
  | { status: 'passwordRequired' }
  | { status: 'wrongPassword' };

export interface ImportSelection {
  snippets: boolean;
  portals: boolean;
  shortcuts: boolean;
  aliases: boolean;
}

export interface CategorySummary {
  added: number;
  skipped: number;
}

export interface ImportSummary {
  snippets: CategorySummary;
  portals: CategorySummary;
  shortcuts: CategorySummary;
  aliases: CategorySummary;
}
