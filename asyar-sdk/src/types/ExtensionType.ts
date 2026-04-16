import { ExtensionContext } from "../ExtensionContext";

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

export interface ExtensionManifest {
  name: string;
  id: string;
  version: string;
  description: string;
  type: "result" | "view" | "theme";
  defaultView?: string;
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
  trigger: string; // Text that triggers this command
  id: string; // Unique command identifier
  resultType?: "no-view" | "view"; // What kind of result this command produces
  icon?: string;
  schedule?: {
    intervalSeconds: number;
  };
  /** Command-level preferences (apply only to this command). */
  preferences?: PreferenceDeclaration[];
  /** Command-level actions (show when this specific command is selected). */
  actions?: ManifestAction[];
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
