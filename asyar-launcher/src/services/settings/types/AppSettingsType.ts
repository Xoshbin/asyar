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
  calculator: {
    refreshInterval: number;
  };
  updates?: {
    channel: "stable" | "beta";
  };
  user?: {
    id?: string;
    name?: string;
    email?: string;
    avatarUrl?: string;
    syncEnabled?: boolean;
    lastSynced?: number;
  };
  ai: {
    provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'openrouter' | 'custom';
    apiKey: string;
    model: string;
    baseUrl?: string;
    systemPrompt?: string;
    temperature: number;
    maxTokens: number;
    allowExtensionUse: boolean;
  };
}
