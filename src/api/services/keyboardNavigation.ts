export class KeyboardNavigationService {
  private selectedIndex: number = 0;
  private itemCount: number = 0;
  private onSelectCallback?: () => void;
  private handleKeyDown: (e: KeyboardEvent) => void;

  constructor() {
    // Recreate the hook's handleKeyDown logic
    this.handleKeyDown = (e: KeyboardEvent) => {
      if (this.itemCount === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          this.selectedIndex = (this.selectedIndex + 1) % this.itemCount;
          break;
        case "ArrowUp":
          e.preventDefault();
          this.selectedIndex =
            (this.selectedIndex - 1 + this.itemCount) % this.itemCount;
          break;
        case "Enter":
          e.preventDefault();
          if (this.onSelectCallback) {
            this.onSelectCallback();
          }
          break;
      }
    };
  }

  public initialize(itemCount: number, onSelect?: () => void): void {
    // Mirror the hook's reset behavior
    this.itemCount = itemCount;
    this.selectedIndex = 0;
    this.onSelectCallback = onSelect;
    this.attachListeners();
  }

  public getCurrentIndex(): number {
    return this.selectedIndex;
  }

  public destroy(): void {
    this.detachListeners();
  }

  private attachListeners(): void {
    window.addEventListener("keydown", this.handleKeyDown);
  }

  private detachListeners(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
  }
}

export const keyboardNavigation = new KeyboardNavigationService();
