import type { IActionService, ExtensionAction } from "../types";
import { ActionContext } from "../types";
import { BaseServiceProxy } from "./BaseServiceProxy";
import { extensionBridge } from "../ExtensionBridge";

export class ActionServiceProxy extends BaseServiceProxy implements IActionService {
  private currentContext: ActionContext = ActionContext.GLOBAL;

  registerAction(action: ExtensionAction): void {
    extensionBridge.registerAction(action.extensionId, action);
    const { execute, ...actionData } = action;
    this.broker.invoke('actions:registerAction', { action: actionData }).catch(err => console.warn('[ActionServiceProxy] registerAction failed:', err));
  }

  unregisterAction(actionId: string): void {
    extensionBridge.unregisterAction(actionId);
    this.broker.invoke('actions:unregisterAction', { actionId }).catch(err => console.warn('[ActionServiceProxy] unregisterAction failed:', err));
  }

  getActions(context?: ActionContext): ExtensionAction[] {
    console.warn('getActions called synchronously in proxy.');
    const allActions = extensionBridge.getActions();
    if (context) {
      return allActions.filter(a => a.context === context);
    }
    return allActions;
  }

  executeAction(actionId: string): Promise<void> {
    return this.broker.invoke<void>('actions:executeAction', { actionId });
  }

  setContext(context: ActionContext, data?: { commandId?: string }): void {
    this.currentContext = context;
    this.broker.invoke('actions:setContext', { context, data }).catch(err => console.warn('[ActionServiceProxy] setContext failed:', err));
  }

  getContext(): ActionContext {
    console.warn('getContext called synchronously in proxy.');
    return this.currentContext;
  }

  registerActionHandler(actionId: string, handler: (payload?: unknown) => Promise<void> | void): void {
    extensionBridge.registerActionHandler(this.extensionId, actionId, handler);
    // Round-trip the registration so the launcher learns which iframe role
    // (view vs worker) owns the handler. The role itself is derived host-side
    // from the calling iframe's [data-role] attribute — never trusted from
    // the payload. Used to dispatch asyar:action:execute to the correct iframe.
    this.broker.invoke('actions:registerActionHandler', { actionId }).catch((err) =>
      console.warn('[ActionServiceProxy] registerActionHandler round-trip failed:', err)
    );
  }
}

