import type { Extension, ExtensionResult } from "../../types/extension";
import { ExtensionApi } from "../../api/extensionApi";
import { alarmState } from "./state";

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    // Match queries like "alarm 5m" or "timer 30s"
    const timerMatch = query.match(
      /^(alarm|timer)\s+(\d+)([smh])(?:\s+(.+))?$/i
    );

    if (timerMatch) {
      const amount = parseInt(timerMatch[2]);
      const unit = timerMatch[3].toLowerCase();
      const message = timerMatch[4] || "Timer finished!";

      let seconds = amount;
      if (unit === "m") seconds = amount * 60;
      if (unit === "h") seconds = amount * 60 * 60;

      const readableTime = formatTime(seconds);

      return [
        {
          title: `Set ${readableTime} timer: ${message}`,
          subtitle: "Press Enter to start timer",
          type: "result",
          action: async () => {
            await createTimer(seconds, message);
            ExtensionApi.window.hide();
          },
          score: 0,
        },
      ];
    }

    // For simple "alarm" query, show the view
    if (
      query.toLowerCase().startsWith("alarm") ||
      query.toLowerCase().startsWith("timer")
    ) {
      return [
        {
          title: "Alarm & Timer",
          subtitle: "View and set alarms and timers",
          type: "view",
          action: async () => {
            await ExtensionApi.navigation.setView("alarm", "AlarmView");
          },
          score: 0,
        },
      ];
    }

    return [];
  },

  async onViewSearch(query: string) {
    alarmState.setSearch(query);
  },
};

async function createTimer(seconds: number, message: string) {
  // Request notification permission if needed
  let permissionGranted = await ExtensionApi.notification.checkPermission();
  if (!permissionGranted) {
    permissionGranted = await ExtensionApi.notification.requestPermission();
    if (!permissionGranted) {
      ExtensionApi.log.error("Notification permission denied");
      return;
    }
  }

  const timerId = Date.now().toString();
  const timerObj = {
    id: timerId,
    duration: seconds,
    message: message,
    createdAt: Date.now(),
    endsAt: Date.now() + seconds * 1000,
    active: true,
  };

  // Add to state
  alarmState.addTimer(timerObj);

  // Set timeout for notification
  setTimeout(async () => {
    await ExtensionApi.notification.notify({
      title: "Timer Finished",
      body: message,
    });
    alarmState.completeTimer(timerId);
  }, seconds * 1000);

  // Show confirmation notification
  await ExtensionApi.notification.notify({
    title: "Timer Started",
    body: `${formatTime(seconds)} timer has been started`,
  });

  return timerObj;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} hour${hours !== 1 ? "s" : ""}${
    minutes > 0 ? ` ${minutes} minute${minutes !== 1 ? "s" : ""}` : ""
  }`;
}

export default extension;
