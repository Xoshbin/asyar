### 8.2 `NotificationService` — System notifications

**Permission required:** `notifications:send`

```typescript
interface INotificationService {
  checkPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  notify(options: NotificationOptions): Promise<void>;
  registerActionTypes(actionTypes: NotificationActionType[]): Promise<void>;
  listenForActions(callback: (notification: any) => void): Promise<void>;
  createChannel(channel: NotificationChannel): Promise<void>;
  getChannels(): Promise<any[]>;
  removeChannel(channelId: string): Promise<void>;
}

type NotificationOptions = {
  title: string;
  body: string;
  icon?: string;
  channelId?: string;
  attachments?: Array<{ id: string; url: string }>;
};

type NotificationChannel = {
  id: string;
  name: string;
  description: string;
  importance?: 0 | 1 | 2 | 3 | 4; // None → High
  visibility?: -1 | 0 | 1;         // Secret, Private, Public
  lights?: boolean;
  lightColor?: string;
  vibration?: boolean;
  sound?: string;
};

type NotificationActionType = {
  id: string;
  actions: Array<{
    id: string;
    title: string;
    requiresAuthentication?: boolean;
    foreground?: boolean;
    destructive?: boolean;
    input?: boolean;
    inputButtonTitle?: string;
    inputPlaceholder?: string;
  }>;
};
```

**Usage:**
```typescript
const notif = context.getService<INotificationService>('NotificationService');

// 1. Check and request permission (do this once during initialize/activate)
const granted = await notif.checkPermission();
if (!granted) await notif.requestPermission();

// 2. Send a basic notification
await notif.notify({ title: 'Export Complete', body: 'Saved to Desktop.' });

// 3. Create a notification channel (groups related notifications)
await notif.createChannel({
  id: 'com.yourname.ext:updates',
  name: 'Extension Updates',
  description: 'Notifications about data sync status',
  importance: 3, // Default
});

// 4. Send to a specific channel
await notif.notify({
  title: 'Sync Complete',
  body: '42 items updated.',
  channelId: 'com.yourname.ext:updates',
});

// 5. Register actionable notification types (reply buttons etc.)
await notif.registerActionTypes([{
  id: 'SYNC_RESULT',
  actions: [{ id: 'view', title: 'View Details' }],
}]);

// 6. Listen for action button clicks
await notif.listenForActions((notification) => {
  if (notification.actionTypeId === 'SYNC_RESULT' && notification.actionId === 'view') {
    // open your extension view
  }
});
```

---
