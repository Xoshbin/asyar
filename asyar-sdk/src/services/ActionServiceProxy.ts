import { IActionService, ExtensionAction, ActionContext } from "../types";
import { BaseServiceProxy } from "./BaseServiceProxy";
import { ExtensionBridge } from "../ExtensionBridge";

export class ActionServiceProxy extends BaseServiceProxy implements IActionService {
  private currentContext: ActionContext = ActionContext.GLOBAL;

  registerAction(action: ExtensionAction): void {
    ExtensionBridge.getInstance().registerAction(action.extensionId, action);
    const { execute, ...actionData } = action;
    this.broker.invoke('action:registerAction', { action: actionData }).catch(console.error);
  }

  unregisterAction(actionId: string): void {
    ExtensionBridge.getInstance().unregisterAction(actionId);
    this.broker.invoke('action:unregisterAction', { actionId }).catch(console.error);
  }

  getActions(context?: ActionContext): ExtensionAction[] {
    console.warn('getActions called synchronously in proxy.');
    const allActions = ExtensionBridge.getInstance().getActions();
    if (context) {
      return allActions.filter(a => a.context === context);
    }
    return allActions;
  }

  executeAction(actionId: string): Promise<void> {
    return this.broker.invoke<void>('action:executeAction', { actionId });
  }

  setContext(context: ActionContext, data?: { commandId?: string }): void {
    this.currentContext = context;
    this.broker.invoke('action:setContext', { context, data }).catch(console.error);
  }

  getContext(): ActionContext {
    console.warn('getContext called synchronously in proxy.');
    return this.currentContext;
  }
}

