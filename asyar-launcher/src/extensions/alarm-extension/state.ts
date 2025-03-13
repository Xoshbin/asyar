import { writable } from "svelte/store";
import type { INotificationService, ILogService } from "asyar-extension-sdk";
import { ExtensionContext } from "asyar-extension-sdk";

export type Timer = {
  id: string;
  duration: number;
  message: string;
  createdAt: number;
  endsAt: number;
  active: boolean;
};

interface AlarmState {
  searchQuery: string;
  filtered: boolean;
  timers: Timer[];
}

function createAlarmState() {
  const { subscribe, set, update } = writable<AlarmState>({
    searchQuery: "",
    filtered: false,
    timers: [],
  });

  let notificationService: INotificationService;
  let logService: ILogService;

  function initializeServices(context: ExtensionContext) {
    notificationService = context.getService("NotificationService");
    logService = context.getService("LogService");
  }

  // Load saved timers from localStorage
  const loadSavedTimers = () => {
    try {
      const savedTimers = localStorage.getItem("asyar-timers");
      if (savedTimers) {
        const parsedTimers = JSON.parse(savedTimers) as Timer[];
        // Only keep active timers that haven't expired yet
        const validTimers = parsedTimers.filter(
          (timer) => timer.active && timer.endsAt > Date.now()
        );

        update((state) => ({
          ...state,
          timers: validTimers,
        }));

        // Set timeouts for remaining time on each timer
        validTimers.forEach((timer) => {
          const timeLeft = Math.max(0, timer.endsAt - Date.now());
          if (timeLeft > 0) {
            setTimeout(() => {
              completeTimer(timer.id);
            }, timeLeft);
          }
        });
      }
    } catch (error) {
      console.error("Failed to load saved timers", error);
    }
  };

  // Save timers to localStorage
  const saveTimers = (timers: Timer[]) => {
    try {
      localStorage.setItem("asyar-timers", JSON.stringify(timers));
    } catch (error) {
      console.error("Failed to save timers", error);
    }
  };

  const addTimer = (timer: Timer) => {
    update((state) => {
      const newTimers = [...state.timers, timer];
      saveTimers(newTimers);
      return {
        ...state,
        timers: newTimers,
      };
    });
  };

  const completeTimer = (id: string) => {
    update((state) => {
      const updatedTimers = state.timers.map((timer) =>
        timer.id === id ? { ...timer, active: false } : timer
      );
      saveTimers(updatedTimers);
      return {
        ...state,
        timers: updatedTimers,
      };
    });
  };

  async function createTimer(seconds: number, message: string) {
    if (!notificationService) {
      throw new Error("Notification service not initialized");
    }

    try {
      // Request notification permission if needed
      let permissionGranted = await notificationService.checkPermission();
      if (!permissionGranted) {
        permissionGranted = await notificationService.requestPermission();
        if (!permissionGranted) {
          throw new Error("Notification permission required");
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
      addTimer(timerObj);

      // Set timeout for notification
      setTimeout(async () => {
        try {
          await notificationService.notify({
            title: "Timer Finished",
            body: message,
          });
          completeTimer(timerId);
        } catch (notifyError) {
          console.error("Error sending notification:", notifyError);
        }
      }, seconds * 1000);

      // Send confirmation notification
      await notificationService.notify({
        title: "Timer Started",
        body: `Timer for ${formatTime(seconds)} has been started`,
      });

      return timerObj;
    } catch (error) {
      logService?.error(`Error in createTimer: ${error}`);
      throw error;
    }
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

  const deleteTimer = (id: string) => {
    update((state) => {
      const filteredTimers = state.timers.filter((timer) => timer.id !== id);
      saveTimers(filteredTimers);
      return {
        ...state,
        timers: filteredTimers,
      };
    });
  };

  // Initialize
  loadSavedTimers();

  return {
    subscribe,
    setSearch: (query: string) =>
      update((state) => ({
        ...state,
        searchQuery: query,
        filtered: query.length > 0,
      })),
    addTimer,
    completeTimer,
    deleteTimer,
    createTimer, // Add this line to expose createTimer function
    reset: () =>
      set({
        searchQuery: "",
        filtered: false,
        timers: [],
      }),
    initializeServices,
  };
}

export const alarmState = createAlarmState();
