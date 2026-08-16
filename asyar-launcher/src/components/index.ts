// Base
export { default as Badge } from './base/Badge.svelte';
export { default as Button } from './base/Button.svelte';
export { default as ExtensionAvatar } from './base/ExtensionAvatar.svelte';
export { default as Icon } from './base/Icon.svelte';
export { default as IconBox } from './base/IconBox.svelte';
export { default as IconButton } from './base/IconButton.svelte';
export { default as Input } from './base/Input.svelte';
export { default as Textarea } from './base/Textarea.svelte';
export { default as MeterBar } from './base/MeterBar.svelte';
export { default as Modal } from './base/Modal.svelte';
export { default as StatTile } from './base/StatTile.svelte';
export { default as KeyboardHint } from './base/KeyboardHint.svelte';
export { default as ShortcutRecorder } from './base/ShortcutRecorder.svelte';
export { default as StatusDot } from './base/StatusDot.svelte';
export { default as TabGroup } from './base/TabGroup.svelte';
export { default as SegmentedControl } from './base/SegmentedControl.svelte';
export { default as Toggle } from './base/Toggle.svelte';
export { default as Checkbox } from './base/Checkbox.svelte';
export { default as Select } from './base/Select.svelte';

// Feedback
export { default as EmptyState } from './feedback/EmptyState.svelte';
export { default as ErrorState } from './feedback/ErrorState.svelte';
export { default as InlineError } from './feedback/InlineError.svelte';
export { default as LoadingState } from './feedback/LoadingState.svelte';
export { default as WarningBanner } from './feedback/WarningBanner.svelte';
export { default as EntitlementGate } from './feedback/EntitlementGate.svelte';
export { default as DialogHost } from './feedback/DialogHost.svelte';
export { default as FeedbackMessage } from './feedback/FeedbackMessage.svelte';

// Layout
export { default as ActionFooter } from './layout/ActionFooter.svelte';
export { default as ActionListPopup } from './layout/ActionListPopup.svelte';
export { default as AppBar } from './layout/AppBar.svelte';
export { default as BottomActionBar } from './layout/BottomActionBar.svelte';
export { default as BottomBarButton } from './layout/BottomBarButton.svelte';
export { default as Card } from './layout/Card.svelte';
export { default as InformationPanel } from './layout/InformationPanel.svelte';
export { default as PrimaryActionDisplay } from './layout/PrimaryActionDisplay.svelte';
export { default as SearchHeader } from './layout/SearchHeader.svelte';
export { default as SearchResultsArea } from './layout/SearchResultsArea.svelte';
export { default as ShortcutCaptureOverlay } from './layout/ShortcutCaptureOverlay.svelte';
export { default as SplitListDetail } from './layout/SplitListDetail.svelte';

// List
export { default as CalcResultCard } from './list/CalcResultCard.svelte';
export { default as LauncherListRow } from './list/LauncherListRow.svelte';
export { default as ListItem } from './list/ListItem.svelte';
export { default as RankedStatRow } from './list/RankedStatRow.svelte';
export { default as ListItemActions } from './list/ListItemActions.svelte';
export { default as ResultsList } from './list/ResultsList.svelte';
export { default as SplitView } from './list/SplitView.svelte';

// Extension
export { default as WorkerIframes } from './extension/WorkerIframes.svelte';
export { default as ExtensionIframe } from './extension/ExtensionIframe.svelte';
export { default as ExtensionViewContainer } from './extension/ExtensionViewContainer.svelte';

// Settings
export { default as SettingsRow } from './settings/SettingsRow.svelte';
export { default as SettingsSection } from './settings/SettingsSection.svelte';
export { default as SettingsTopBar } from './settings/SettingsTopBar.svelte';
export { default as SettingsCard } from './settings/SettingsCard.svelte';
export { default as SettingsRadioGroup } from './settings/SettingsRadioGroup.svelte';
export { default as SettingsRangeSlider } from './settings/SettingsRangeSlider.svelte';
export { default as SettingsForm } from './settings/SettingsForm.svelte';
export { default as SettingsFormRow } from './settings/SettingsFormRow.svelte';
export { default as AppearanceThemeSelector } from './settings/AppearanceThemeSelector.svelte';
export { default as WindowModeSelector } from './settings/WindowModeSelector.svelte';
export { default as ExtensionDetailPanel } from './settings/ExtensionDetailPanel.svelte';
export { default as ExtensionPreferencesForm } from './settings/ExtensionPreferencesForm.svelte';

// Form
export { default as FormField } from './form/FormField.svelte';
export { default as PlaceholderPicker } from './form/PlaceholderPicker.svelte';

// Onboarding
export { default as GuidanceStep } from './onboarding/GuidanceStep.svelte';
export { default as LauncherHint } from './onboarding/LauncherHint.svelte';
export { default as OnboardingStage } from './onboarding/OnboardingStage.svelte';
export { default as StepProgress } from './onboarding/StepProgress.svelte';
export { default as TestBox } from './onboarding/TestBox.svelte';
export { default as ExpansionDemo } from './onboarding/ExpansionDemo.svelte';

// Search
export { default as ArgumentChipRow } from './search/ArgumentChipRow.svelte';
export { default as CommandArgInput } from './search/CommandArgInput.svelte';
export { default as ArgumentDropdownChip } from './search/ArgumentDropdownChip.svelte';
export { default as SearchBarAccessoryDropdown } from './search/SearchBarAccessoryDropdown.svelte';

// ── Additions below complete the barrel ────────────────────────────────────
// Everything in components/ is exported from here except the two cases noted
// at the bottom of this file. If you add a component, add its export in the
// matching section — `pnpm check:design` fails the build if you forget.

// Base
export { default as Spinner } from './base/Spinner.svelte';

// Feedback
export { default as CrashReportPrompt } from './feedback/CrashReportPrompt.svelte';
export { default as PermissionConsentDialog } from './feedback/PermissionConsentDialog.svelte';
export { default as UsageSharePrompt } from './feedback/UsageSharePrompt.svelte';

// Layout
export { default as AppShell } from './layout/AppShell.svelte';
export { default as ShowMoreBarHuds } from './layout/ShowMoreBarHuds.svelte';

// List
export { default as SectionedResultsList } from './list/SectionedResultsList.svelte';

// Shell
export { default as ShellConsentDialog } from './shell/ShellConsentDialog.svelte';

// Settings — sections
export { default as ClipboardPrivacySection } from './settings/ClipboardPrivacySection.svelte';
export { default as CrashReportSection } from './settings/CrashReportSection.svelte';
export { default as EncryptionStatusSection } from './settings/EncryptionStatusSection.svelte';
export { default as RuntimesSection } from './settings/RuntimesSection.svelte';
export { default as ScheduledTasksSection } from './settings/ScheduledTasksSection.svelte';
export { default as SecretRedactionSection } from './settings/SecretRedactionSection.svelte';
export { default as UsageShareSection } from './settings/UsageShareSection.svelte';

// Settings — controls and lists
export { default as PermissionList } from './settings/PermissionList.svelte';
export { default as RuntimeDownloadList } from './settings/RuntimeDownloadList.svelte';
export { default as ShellTrustManager } from './settings/ShellTrustManager.svelte';

// Settings — dialogs
export { default as DisableE2eeDialog } from './settings/DisableE2eeDialog.svelte';
export { default as EncryptionEnrolmentDialog } from './settings/EncryptionEnrolmentDialog.svelte';
export { default as PassphraseDialog } from './settings/PassphraseDialog.svelte';
export { default as PreferencesPromptHost } from './settings/PreferencesPromptHost.svelte';
export { default as RecoverWithMnemonicDialog } from './settings/RecoverWithMnemonicDialog.svelte';
export { default as RecoveryPhraseDialog } from './settings/RecoveryPhraseDialog.svelte';
export { default as RequiredPreferencesDialog } from './settings/RequiredPreferencesDialog.svelte';
export { default as RotatePassphraseDialog } from './settings/RotatePassphraseDialog.svelte';

// Dev — the extension inspector. Only the shell is exported; its panels are
// internal to it and importing one on its own is always a mistake.
export { default as InspectorShell } from './dev/InspectorShell.svelte';

// ── Deliberately NOT exported ──────────────────────────────────────────────
// base/ConfirmDialog  — go through DialogHost, or import the file directly if
//                       you genuinely need to mount your own.
// feedback/ToastHost, feedback/FatalErrorDialog,
// feedback/FeedbackDetailsDialog, layout/FeedbackBar
//                     — feedback presenters. Only BottomActionBar, FeedbackBar
//                       and routes/+page.svelte may mount them; publish through
//                       feedbackService instead. Enforced by
//                       services/feedback/feedbackBoundary.test.ts.
// dev/Panel*, dev/JsonTree, dev/StreamTail, dev/ExtensionNav, dev/HelpPanel,
// dev/TimestampRelative — internals of InspectorShell (see above).
