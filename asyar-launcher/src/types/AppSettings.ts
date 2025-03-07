// Define settings structure
export interface AppSettings {
  general: {
    startAtLogin: boolean;
    showDockIcon: boolean;
  };
  search: {
    searchApplications: boolean;
    searchSystemPreferences: boolean;
    fuzzySearch: boolean;
  };
  shortcut: {
    modifier: string;
    key: string;
  };
  appearance: {
    theme: "system" | "light" | "dark";
    windowWidth: number;
    windowHeight: number;
  };
  // Add extensions section to store enabled/disabled state
  extensions: {
    enabled: Record<string, boolean>;
  };
  // Reserved for future user-specific settings that might sync to cloud
  user?: {
    id?: string;
    syncEnabled?: boolean;
    lastSynced?: number;
  };
}
