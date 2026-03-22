export interface IStatusBarItem {
  id: string;
  icon?: string;
  text: string;
}

export interface IStatusBarService {
  registerItem(item: IStatusBarItem): void;
  updateItem(
    id: string,
    updates: Partial<Pick<IStatusBarItem, 'icon' | 'text'>>
  ): void;
  unregisterItem(id: string): void;
}
