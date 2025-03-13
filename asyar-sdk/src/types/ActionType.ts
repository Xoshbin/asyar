export interface ExtensionAction {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  extensionId: string;
  category?: string;
  execute: () => Promise<void> | void;
}

export interface IActionService {
  registerAction(action: ExtensionAction): void;
  unregisterAction(actionId: string): void;
  getActions(): ExtensionAction[];
  executeAction(actionId: string): Promise<void>;
}
