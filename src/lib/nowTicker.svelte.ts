// Shared 1-Hz "now" ticker. Components that render live elapsed times
// (e.g. "Running · 12s") subscribe via useNowTicker() inside onMount and
// read nowTicker.now in their reactive expressions. Refcounted so only
// one setInterval runs no matter how many rows are visible.

class NowTicker {
  now = $state(Date.now());
  private subscribers = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  subscribe(): () => void {
    this.subscribers++;
    if (this.intervalId === null) {
      this.now = Date.now();
      this.intervalId = setInterval(() => {
        this.now = Date.now();
      }, 1000);
    }
    return () => {
      this.subscribers--;
      if (this.subscribers === 0 && this.intervalId !== null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    };
  }
}

export const nowTicker = new NowTicker();
