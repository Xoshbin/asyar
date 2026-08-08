# Component Catalogue

Every component in the Asyar launcher, grouped by what you would be building
when you reach for it. All of them are exported from
`asyar-launcher/src/components/index.ts`:

```svelte
import {(Button, EmptyState, ListItem, SplitView)} from '../../components';
```

> These are **launcher-internal** components. Third-party (Tier 2) extensions
> run in a sandboxed iframe and cannot import them — extensions get the design
> tokens and the `<asyar-icon>` web component instead. See
> [Tokens](./tokens.md) and [Icons](./icons.md).

The rules for choosing between them live in
[`.agents/skills/design-language/SKILL.md`](../../../.agents/skills/design-language/SKILL.md),
which is also what AI coding agents read. `pnpm check:design` fails the build
if a component exists but is missing from the barrel, so this catalogue and
the code cannot drift apart silently.

---

## Controls

| Component          | Use for                                            |
| :----------------- | :------------------------------------------------- |
| `Button`           | Any button. Never write a styled `<button>`        |
| `IconButton`       | An icon-only button                                |
| `BottomBarButton`  | A button in the launcher's bottom action bar       |
| `Input`            | A single-line text field                           |
| `Textarea`         | A multi-line text field                            |
| `Select`           | A dropdown of fixed options                        |
| `Checkbox`         | A boolean in a list of choices                     |
| `Toggle`           | A boolean that applies immediately (a setting)     |
| `SegmentedControl` | Two to four exclusive options, shown inline        |
| `TabGroup`         | Top-level navigation. Variants: `pills`, `sidebar` |
| `ShortcutRecorder` | Capturing a keyboard shortcut from the user        |

## Display

| Component         | Use for                                                          |
| :---------------- | :--------------------------------------------------------------- |
| `Badge`           | A status word. Variants: default, success, warning, danger, info |
| `StatusDot`       | A status dot, with optional pulse                                |
| `MeterBar`        | Progress or capacity                                             |
| `StatTile`        | A single headline number                                         |
| `RankedStatRow`   | A row in a ranked/leaderboard list                               |
| `KeyboardHint`    | Displaying a keyboard shortcut                                   |
| `Icon`            | A built-in SVG icon, by `name`                                   |
| `IconBox`         | A sized container for an icon (sm/md/lg/xl)                      |
| `ExtensionAvatar` | An extension's avatar tile                                       |
| `Spinner`         | A busy indicator. Sizes: `inline`, `sm`, `md`                    |

## Feedback and state

| Component           | Use for                                                                                                                |
| :------------------ | :--------------------------------------------------------------------------------------------------------------------- |
| `EmptyState`        | "There is nothing here." `compact` for a panel inside a fuller view; `bordered` when it doubles as "add the first one" |
| `LoadingState`      | "This is loading" — a centred spinner and message                                                                      |
| `ErrorState`        | "This failed", at view level                                                                                           |
| `InlineError`       | A validation error inside a form                                                                                       |
| `WarningBanner`     | A non-blocking caution                                                                                                 |
| `FeedbackMessage`   | A single status line, with marquee for long text                                                                       |
| `FeedbackBar`       | The launcher's persistent status strip                                                                                 |
| `ToastHost`         | Transient confirmations. Already mounted app-wide; publish via `feedbackService` rather than importing it              |
| `EntitlementGate`   | Content gated behind an entitlement                                                                                    |
| `CrashReportPrompt` | The post-crash report prompt                                                                                           |
| `UsageSharePrompt`  | The usage-sharing opt-in prompt                                                                                        |

## Dialogs

All dialogs are built on `Modal`, which uses a native `<dialog>` — it renders
in the browser's top layer, so it is always above other content regardless of
z-index.

| Component                 | Use for                                                                                                                                         |
| :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modal`                   | **Any** dialog. Props: `isOpen` (bindable), `title`, `subtitle`, `width`, `dismissible`, `onEscape`, `onEnter`; `children` + `actions` snippets |
| `DialogHost`              | The app-wide slot that renders queued confirmations. Prefer this over mounting a confirm dialog yourself                                        |
| `FatalErrorDialog`        | An unrecoverable error                                                                                                                          |
| `PermissionConsentDialog` | Asking for a permission                                                                                                                         |
| `ShellConsentDialog`      | Consent to run a shell command                                                                                                                  |
| `FeedbackDetailsDialog`   | The expanded detail behind a status message                                                                                                     |

The feedback presenters — `ToastHost`, `FatalErrorDialog`,
`FeedbackDetailsDialog` and `FeedbackBar` — are **not** exported either. Only
`BottomActionBar`, `FeedbackBar` and `routes/+page.svelte` may mount them;
everything else publishes through `feedbackService`. The boundary is enforced
by `services/feedback/feedbackBoundary.test.ts`.

`ConfirmDialog` is deliberately **not** exported — go through `DialogHost`, or
import `components/base/ConfirmDialog.svelte` directly if you genuinely need
to mount your own.

## Lists

| Component              | Use for                                                  |
| :--------------------- | :------------------------------------------------------- |
| `ListItem`             | A row. Leading / title / subtitle / trailing slots       |
| `ListItemActions`      | The trailing action cluster on a row                     |
| `ResultsList`          | A long, virtualised result list                          |
| `SectionedResultsList` | The same, with group headers                             |
| `LauncherListRow`      | A launcher search-result row                             |
| `CalcResultCard`       | The calculator's result card                             |
| `SplitView`            | A resizable two-pane layout with a drag handle           |
| `SplitListDetail`      | A master/detail page, including the standard empty state |

## Layout

| Component                | Use for                                      |
| :----------------------- | :------------------------------------------- |
| `AppShell`               | The app frame                                |
| `AppBar`                 | A page header with a back button             |
| `SearchHeader`           | The launcher's fixed search header           |
| `SearchResultsArea`      | The launcher's results region                |
| `BottomActionBar`        | The launcher's fixed bottom bar              |
| `ShowMoreBarHuds`        | The compact-mode "show more" seam            |
| `ActionFooter`           | Actions pinned to the bottom of a view       |
| `ActionListPopup`        | A ⌘K-style action menu                       |
| `Card`                   | A card surface                               |
| `InformationPanel`       | A labelled information panel                 |
| `PrimaryActionDisplay`   | The highlighted primary action               |
| `ShortcutCaptureOverlay` | The overlay shown while capturing a shortcut |

## Search

| Component                    | Use for                                 |
| :--------------------------- | :-------------------------------------- |
| `CommandArgInput`            | Entering a command's arguments          |
| `ArgumentChipRow`            | The row of argument chips               |
| `ArgumentDropdownChip`       | An argument chip with a dropdown        |
| `SearchBarAccessoryDropdown` | An accessory dropdown in the search bar |

## Forms and settings

| Component                  | Use for                                       |
| :------------------------- | :-------------------------------------------- |
| `FormField`                | A labelled field with hint and error          |
| `PlaceholderPicker`        | Inserting a placeholder token into a field    |
| `SettingsForm`             | The frame for a settings page                 |
| `SettingsSection`          | A titled group of settings                    |
| `SettingsRow`              | One setting: label, description, control slot |
| `SettingsFormRow`          | The same, inside a `SettingsForm`             |
| `SettingsRadioGroup`       | A set of radio choices                        |
| `SettingsRangeSlider`      | A numeric slider                              |
| `SettingsTopBar`           | The settings window's top bar                 |
| `AppearanceThemeSelector`  | The theme picker                              |
| `WindowModeSelector`       | The window-mode picker                        |
| `PermissionList`           | A list of granted permissions                 |
| `ShellTrustManager`        | Managing trusted shell commands               |
| `RuntimeDownloadList`      | Runtime downloads in progress                 |
| `ExtensionDetailPanel`     | The detail pane for an extension              |
| `ExtensionPreferencesForm` | An extension's own preferences                |

**Settings sections** — drop-in blocks for the settings pages:
`ClipboardPrivacySection`, `CrashReportSection`, `EncryptionStatusSection`,
`RuntimesSection`, `ScheduledTasksSection`, `SecretRedactionSection`,
`UsageShareSection`.

**Encryption dialogs** — `EncryptionEnrolmentDialog`, `PassphraseDialog`,
`RotatePassphraseDialog`, `RecoveryPhraseDialog`, `RecoverWithMnemonicDialog`,
`DisableE2eeDialog`, plus `RequiredPreferencesDialog` and
`PreferencesPromptHost`.

## Onboarding

| Component         | Use for                                            |
| :---------------- | :------------------------------------------------- |
| `OnboardingStage` | The frame for one onboarding step. Owns the layout |
| `GuidanceStep`    | A single instruction within a stage                |
| `StepProgress`    | Progress through the onboarding sequence           |
| `LauncherHint`    | A hint card pointing at launcher behaviour         |
| `TestBox`         | A "try it now" box                                 |
| `ExpansionDemo`   | The compact→expanded animation demo                |

## Extension hosting and dev

| Component                | Use for                                                                                  |
| :----------------------- | :--------------------------------------------------------------------------------------- |
| `ExtensionViewContainer` | Hosting an extension's view                                                              |
| `ExtensionIframe`        | The view iframe itself                                                                   |
| `WorkerIframes`          | The hidden worker iframes                                                                |
| `InspectorShell`         | The extension inspector. Its panels are internal to it and are not exported individually |
