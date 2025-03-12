declare enum Importance {
  None = 0,
  Min = 1,
  Low = 2,
  Default = 3,
  High = 4,
}

declare enum Visibility {
  Secret = -1,
  Private = 0,
  Public = 1,
}

export type NotificationOptions = {
  title: string;
  body: string;
  icon?: string;
  channelId?: string;
  attachments?: Array<{
    id: string;
    url: string; // Using asset:// or file:// protocol
  }>;
};

export type NotificationChannel = {
  id: string;
  name: string;
  description: string;
  importance?: Importance;
  visibility?: Visibility;
  lights?: boolean;
  lightColor?: string;
  vibration?: boolean;
  sound?: string;
};

export type NotificationActionType = {
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
