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
    enableExtensionSearch: boolean; // NEW — allow Tier 2 extensions to provide search results
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
  // Add extensions section to store enabled/disabled state
  extensions: {
    enabled: Record<string, boolean>;
    autoUpdate?: boolean;
  };
  calculator: {
    refreshInterval: number; // in hours
  };
  updates?: {
    channel: "stable" | "beta";
  };
  // Reserved for future user-specific settings that might sync to cloud
  user?: {
    id?: string;
    name?: string;
    email?: string;
    avatarUrl?: string;
    syncEnabled?: boolean;
    lastSynced?: number;
  };
}
