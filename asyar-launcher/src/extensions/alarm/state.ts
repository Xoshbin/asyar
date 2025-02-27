import { writable } from "svelte/store";

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
    reset: () =>
      set({
        searchQuery: "",
        filtered: false,
        timers: [],
      }),
  };
}

export const alarmState = createAlarmState();
