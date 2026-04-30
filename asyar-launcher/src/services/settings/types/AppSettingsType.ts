import type { ProviderId, ProviderConfig } from '../../ai/IProviderPlugin';

// Re-export for consumers that import from here
export type { ProviderId, ProviderConfig };

// Define settings structure
export interface AppSettings {
  general: {
    startAtLogin: boolean;
    showDockIcon: boolean;
    escapeInViewBehavior?: "go-back" | "close-window" | "hide-and-reset";
  };
  search: {
    searchApplications: boolean;
    searchSystemPreferences: boolean;
    fuzzySearch: boolean;
    enableExtensionSearch: boolean;
    allowExtensionActions: boolean;
    additionalScanPaths: string[];
    applicationEnabled: Record<string, boolean>;
  };
  shortcut: {
    modifier: string;
    key: string;
  };
  appearance: {
    theme: "system" | "light" | "dark";
    launchView: "default" | "compact";
    windowWidth: number;
    windowHeight: number;
    activeTheme?: string | null;
  };
  extensions: {
    enabled: Record<string, boolean>;
    autoUpdate?: boolean;
  };
  onboarding: {
    completed: boolean;
  };
  updates?: {
    channel: "stable" | "beta";
    autoCheck: boolean;
    lastSeenVersion?: string;
  };
  user?: {
    id?: string;
    name?: string;
    email?: string;
    avatarUrl?: string;
    syncEnabled?: boolean;
    lastSynced?: number;
  };
  ai: AISettings;
  developer?: DeveloperSettings;
}

export interface DeveloperSettings {
  /** Master toggle — gates all developer features */
  enabled: boolean;
  /** Show the DevEx Inspector panel in the main launcher */
  showInspector: boolean;
  /** Enable verbose extension logging */
  verboseLogging: boolean;
  /** Record IPC/RPC traces for the inspector */
  tracing: boolean;
  /** Allow sideloading extensions from local files */
  allowSideloading: boolean;
}

export interface AISettings {
  providers: Record<ProviderId, ProviderConfig>;
  activeProviderId: ProviderId | null;
  activeModelId: string | null;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  allowExtensionUse: boolean;
}
