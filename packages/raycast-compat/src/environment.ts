function getInjected(): Record<string, any> {
  if (typeof window !== 'undefined' && (window as any).__ASYAR_ENVIRONMENT__) {
    return (window as any).__ASYAR_ENVIRONMENT__;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).__ASYAR_ENVIRONMENT__) {
    return (globalThis as any).__ASYAR_ENVIRONMENT__;
  }
  return {};
}

export const environment = {
  get isDevelopment(): boolean {
    return getInjected().isDevelopment ?? false;
  },

  get theme(): 'dark' | 'light' {
    return getInjected().theme ?? 'dark';
  },

  get raycastVersion(): string {
    return '1.85.0'; // Raycast API version compatibility level
  },

  get commandName(): string {
    const injected = getInjected();
    if (injected.commandId) return injected.commandId;
    if (typeof window !== 'undefined' && window.location) {
      const search = new URLSearchParams(window.location.search);
      return search.get('command') || search.get('view') || 'default';
    }
    return 'default';
  },

  get extensionName(): string {
    const injected = getInjected();
    if (injected.extensionId) return injected.extensionId;
    if (typeof window !== 'undefined' && window.location) {
      const hostname = window.location.hostname;
      if (hostname && hostname !== 'localhost') return hostname;
    }
    return 'org.asyar.raycast-extension';
  },

  get commandMode(): 'view' | 'no-view' | 'menu-bar' {
    if (typeof window !== 'undefined') {
      const role = (window as any).__ASYAR_ROLE__;
      if (role === 'worker') return 'no-view';
      if (role === 'view') return 'view';
    }
    return 'view';
  },

  get assetsPath(): string {
    return './assets';
  },

  get supportPath(): string {
    return './support';
  },

  get textSize(): 'small' | 'medium' | 'large' {
    return 'medium';
  },
};
