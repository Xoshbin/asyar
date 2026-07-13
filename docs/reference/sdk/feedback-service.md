# Feedback service

`FeedbackService` is the single path for user-visible operation feedback from built-ins and Tier 2 extensions.

HUD, announcement, notification, dialog, and bar presenters are private implementation details. Launcher features import only `feedbackService`; Tier 2 extensions obtain only the `feedback` SDK proxy over IPC. Architecture tests and restricted imports reject direct child access.

| Situation                                                                    | Surface            |
| ---------------------------------------------------------------------------- | ------------------ |
| Progress, information, success, warning, or error while the launcher is open | Feedback Bar       |
| Field validation in a form                                                   | Inline field error |
| A view cannot render its primary content                                     | Inline view state  |
| Immediate confirmation after the launcher closes                             | HUD                |
| Background, delayed, or scheduled completion                                 | OS notification    |
| Unrecoverable launcher failure                                               | Fatal dialog       |
| Rare product or extension announcement                                       | `announce()` popup |

## Normal feedback

```ts
await feedback.report({
  kind: 'network_failure',
  severity: 'error',
  retryable: false,
  developerDetail: String(error),
});
```

The launcher decides ordering, lifetime, deduplication, colors, and whether a Details button is shown. Long text stays in the fixed-height bar and slowly scrolls when it does not fit.

## Progress

```ts
const progress = await feedback.showProgress({ title: 'Downloading extension' });

try {
  await download();
  await progress.succeed('Extension installed');
} catch (error) {
  await progress.fail('Installation failed', String(error));
}
```

Use the returned handle to update a stage or determinate count:

```ts
await progress.update({ title: 'Installing', completed: 2, total: 3 });
```

## Rare announcements

`announce()` is intentionally not named `showToast`. It is not an operation-feedback API.

```ts
await feedback.announce({
  id: 'whats-new-2',
  title: "What's new",
  message: 'This extension now supports profiles.',
});
```

Tier 2 extensions must declare `feedback:announce`. The host controls the appearance, permits at most one announcement from an extension per launcher session, and may suppress a request. Extensions cannot set severity, progress, custom colors, duration, or arbitrary click handlers.

## HUD and confirmation

Use `showHUD()` only when the launcher closes as part of the action:

```ts
await clipboard.writeText(value);
await feedback.showHUD('Copied');
```

Use `confirmAlert()` for a blocking decision before a destructive or sensitive action. HUDs and confirmation dialogs are not replacements for Feedback Bar messages.

## Notifications

OS notifications are for background or delayed work whose completion time is unknown and does not require the launcher to remain open. Do not send a notification for an operation the user is currently watching in the launcher.

```ts
const feedbackId = await feedback.sendBackground({
  title: 'Export complete',
  body: 'Your archive is ready.',
});

// If the result becomes irrelevant before the user sees it:
await feedback.dismissBackground(feedbackId);
```

Background delivery requires `notifications:send`, but it still travels through the `feedback` facade and the `feedback:*` IPC namespace. There is no public notification service.
