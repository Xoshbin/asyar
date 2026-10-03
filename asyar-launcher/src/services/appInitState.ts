// Module-level application initialization state.
// Decouples consumer services (e.g. searchOrchestrator, launcherController)
// from the monolithic appInitializer dependency graph.

let appInitialized = false;

export function isAppInitialized(): boolean {
  return appInitialized;
}

export function setAppInitialized(initialized: boolean): void {
  appInitialized = initialized;
}
