import { WindowApi } from "./WindowApi";
import { ApplicationApi } from "./ApplicationApi";
import { NavigationApi } from "./NavigationApi";
import { LoggingApi } from "./LoggingApi";
import { NotificationApi } from "./NotificationApi";
import { ClipboardApi } from "./ClipboardApi";

/**
 * API wrapper exposing application functionality to extensions
 */
export class ExtensionApi {
  static clipboard = ClipboardApi;
  static window = WindowApi;
  static apps = ApplicationApi;
  static navigation = NavigationApi;
  static log = LoggingApi;
  static notification = NotificationApi;
}
