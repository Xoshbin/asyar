import type { ExtensionContext } from "../ExtensionContext";

/**
 * The set of preference types an extension can declare in its manifest.
 * Values stored for each type:
 *   - textfield / password / file / directory → string
 *   - number → number
 *   - checkbox → boolean
 *   - dropdown → string (from the `data` array)
 *   - appPicker → { path: string; name: string; bundleId?: string }
 *
 * `password` values are encrypted at rest using a device-local AES-256-GCM
 * key and are excluded from cloud sync.
 */
export type PreferenceType =
  | "textfield"
  | "password"
  | "number"
  | "checkbox"
  | "dropdown"
  | "appPicker"
  | "file"
  | "directory";

export interface DropdownOption {
  value: string;
  title: string;
}

/**
 * A single preference declared by an extension in its manifest.
 * Preferences can live at the extension level (apply to all commands) or
 * on a specific command (apply only to that command). Values are auto-
 * rendered into a settings panel by the launcher and injected into the
 * extension via `context.preferences`.
 */
export interface PreferenceDeclaration {
  /** Unique key for this preference. Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/. */
  name: string;
  type: PreferenceType;
  /** UI label shown next to the input. */
  title: string;
  /** UI hint shown below the label. */
  description?: string;
  /** If true, commands cannot execute until the user sets a value. */
  required?: boolean;
  /** Default value used until the user saves a value. */
  default?: string | number | boolean;
  /** Placeholder text for textfield / number / password. */
  placeholder?: string;
  /** Options for dropdown type. */
  data?: DropdownOption[];
}

/**
 * An action declared in manifest.json that surfaces in the launcher action drawer.
 * Extension-level actions appear when any of the extension's commands is selected.
 * Command-level actions appear only when the specific command is selected.
 */
export interface ManifestAction {
  /** Unique action identifier within the extension. Must match /^[a-zA-Z][a-zA-Z0-9_-]*$/. */
  id: string;
  /** Display label in the action drawer. */
  title: string;
  /** Subtitle text shown below the title. */
  description?: string;
  /** Icon reference (e.g. "icon:link" or an emoji). */
  icon?: string;
  /** Display-only keyboard shortcut hint. */
  shortcut?: string;
  /** Grouping category in the action drawer. */
  category?: string;
}

/**
 * Declares the always-on worker bundle for extensions that host background
 * work (subscriptions, schedules, timers, tray updates). Required when any
 * command declares `mode: "background"`.
 */
export interface BackgroundSpec {
  /** Path (relative to the extension root) of the compiled worker bundle. */
  main: string;
}

export interface ExtensionManifest {
  name: string;
  id: string;
  version: string;
  description: string;
  /**
   * Top-level extension kind. Defaults to `"extension"` when absent.
   * Legal values under the Tier 2 worker/view split are only `"extension"`
   * and `"theme"`; the legacy values `"view"` and `"result"` are strictly
   * rejected by the Rust parser. Per-command `mode` now carries the
   * view/background distinction.
   */
  type?: "extension" | "theme";
  /**
   * Worker bundle declaration. Present iff the extension declares at least
   * one `mode: "background"` command (or reserves a push-event subscription
   * for a future phase).
   */
  background?: BackgroundSpec;
  searchable?: boolean;
  icon?: string;
  commands: ExtensionCommand[];
  asyarSdk?: string;
  minAppVersion?: string;
  platforms?: string[];
  permissions?: string[];
  /** Extension-level preferences (apply to all commands). */
  preferences?: PreferenceDeclaration[];
  /** Extension-level actions (show when any command from this extension is selected). */
  actions?: ManifestAction[];
}

export interface ExtensionCommand {
  name: string;
  description: string;
  /** Text that triggers this command. */
  trigger?: string;
  /** Unique command identifier. */
  id: string;
  /**
   * Execution mode. `"view"` commands open the on-demand view iframe and
   * render the component named by `component`. `"background"` commands
   * execute in the always-on worker context. Replaces the legacy
   * `resultType` field.
   */
  mode?: "view" | "background";
  icon?: string;
  /**
   * Name of the Svelte component exported by the extension's `view.ts`
   * entry. Required iff `mode === "view"`; forbidden when
   * `mode === "background"`.
   */
  component?: string;
  schedule?: {
    intervalSeconds: number;
  };
  /** Command-level preferences (apply only to this command). */
  preferences?: PreferenceDeclaration[];
  /** Command-level actions (show when this specific command is selected). */
  actions?: ManifestAction[];
  /**
   * Declarative argument fields. When present, Tab on the selected command
   * promotes it into argument-entry mode; submitted values arrive under
   * `args.arguments.<name>` in the command handler. Max 3, required args
   * must precede optional ones.
   */
  arguments?: import("./CommandType").CommandArgument[];
  /**
   * Optional per-command searchbar accessory declaration. When present
   * AND `mode === "view"`, the launcher renders a dropdown in the
   * top-right of the search bar that the active view's code reacts to
   * via the `searchBarAccessory.onChange` SDK API. Validated by the
   * manifest parser at install time — must have non-empty `options[]`,
   * and `default` (when present) must be one of those options' values.
   */
  searchBarAccessory?: import("./SearchBarAccessoryType").SearchBarAccessoryManifestDeclaration;
}

export interface ExtensionResult {
  score: number;
  title: string;
  subtitle?: string;
  type: "result" | "view";
  action: () => void | Promise<void>;
  viewPath?: string;
  icon?: string;
  style?: "default" | "large";
  /**
   * @internal Reserved for built-in features (Calculator, Currency, etc.) that
   * compute synthetic answers from the user's query. Third-party extensions
   * may set this field, but the launcher silently strips it before ranking.
   * Pin-to-top is not part of the public extension API.
   */
  priority?: "top";
}

/**
 * An extension manifest enriched with runtime state, as returned by
 * `getAllExtensionsWithState()`. Matches the shape built by the
 * launcher's `extensionStateManager`.
 */
export interface ExtensionWithState {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  keywords: string;
  enabled: boolean;
  version: string;
  isBuiltIn: boolean;
  compatibility: string | null;
  commands: ExtensionCommand[];
  preferences: PreferenceDeclaration[];
}

// Extension interface only contains functionality methods, no metadata
export interface Extension {
  initialize(context: ExtensionContext): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  onUnload?: () => void | Promise<void>;
  viewActivated?(viewId: string): Promise<void>;
  viewDeactivated?(viewId: string): Promise<void>;

  /**
   * Performs a complex search operation.
   *
   * @remarks
   * The search method should be used with caution due to its potential impact on performance and resource consumption.
   * It's designed for search queries that cannot be implemented using the standard command registration system.
   * For typical search functionalities, please utilize the command registration mechanism for better efficiency.
   */
  search?: (query: string) => Promise<ExtensionResult[]>;

  onViewSearch?: (query: string) => Promise<void>;
  onViewSubmit?: (query: string) => Promise<void>;
  onViewKeydown?: (event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }) => Promise<void>;

  // Required command handling method
  executeCommand: (
    commandId: string,
    args?: Record<string, unknown>
  ) => Promise<unknown>;
}
