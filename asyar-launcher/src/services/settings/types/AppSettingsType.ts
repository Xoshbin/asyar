import type { ProviderId, ProviderConfig } from '../../ai/IProviderPlugin';

// Re-export for consumers that import from here
export type { ProviderId, ProviderConfig };

// Define settings structure
export interface AppSettings {
  general: {
    startAtLogin: boolean;
    showDockIcon: boolean;
    escapeInViewBehavior?: "go-back" | "close-window";
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
