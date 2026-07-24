// asyar-launcher/src/lib/ipc/commands.ts
//
// Barrel of Tauri command wrappers. Each wrapper lives in a domain-specific
// `*Commands.ts` module; this file only re-exports them. Add new wrappers to
// the matching module (or a new one) — never inline a wrapper in this barrel.

export * from './extensionPreferencesCommands';
export * from './commandArgDefaultsCommands';
export * from './iframeLifecycleCommands';
export * from './browserCommands';
export * from './extensionLifecycleCommands';
export * from './shortcodeCommands';
export * from './shellCommands';
export * from './applicationCommands';
export * from './statusBarCommands';
export * from './extensionBuilderCommands';
export * from './systemCommands';
export * from './searchAccessoryCommands';
export * from './clipboardCommands';
export * from './settingsUiCommands';
export * from './updateCommands';
export * from './searchCommands';
export * from './applicationIndexCommands';
export * from './windowCommands';
export * from './extensionCommands';
export * from './shortcutCommands';
export * from './systemMiscCommands';
export * from './fileCommands';
export * from './clipboardHistoryCommands';
export * from './snippetCommands';
export * from './notesCommands';
export * from './extensionStorageCommands';
export * from './profileCommands';
export * from './permissionCommands';
export * from './authCommands';
export * from './syncCommands';
export * from './onboardingCommands';
export * from './privacyCommands';
export * from './scriptCommands';
export * from './agentCommands';
export * from './feedbackCommands';
export * from './usageCommands';
export * from './systemActionCommands';
