import { WindowApi } from "./windowApi";
import { ApplicationApi } from "./applicationApi";
import { NavigationApi } from "./navigationApi";
import { LoggingApi } from "./loggingApi";
import { NotificationApi } from "./notificationApi";
import { ClipboardApi } from "./clipboardApi";
import type { IApplicationApi } from "./interfaces/IApplicationApi";
import type { IWindowApi } from "./interfaces/IWindowApi";
import type { INavigationApi } from "./interfaces/INavigationApi";
import type { ILoggingApi } from "./interfaces/ILoggingApi";
import type { INotificationApi } from "./interfaces/INotificationApi";
import type { IClipboardApi } from "./interfaces/IClipboardApi";

/**
 * API wrapper exposing application functionality to extensions
 */
export class ExtensionApi {
  static clipboard: IClipboardApi = new ClipboardApi();
  static window: IWindowApi = new WindowApi();
  static apps: IApplicationApi = new ApplicationApi();
  static navigation: INavigationApi = new NavigationApi();
  static log: ILoggingApi = new LoggingApi();
  static notification: INotificationApi = new NotificationApi();
}
