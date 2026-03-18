import { IActionService, ExtensionAction, ActionContext } from "../types";
import { MessageBroker } from "../ipc/MessageBroker";
import { ExtensionBridge } from "../ExtensionBridge";

export class ActionServiceProxy implements IActionService {
  private broker: MessageBroker;
  private currentContext: ActionContext = ActionContext.GLOBAL;
  private extensionId?: string;

  constructor() {
    this.broker = MessageBroker.getInstance();
  }

  setExtensionId(id: string) {
    this.extensionId = id;
    const originalInvoke = this.broker.invoke.bind(this.broker);
    this.broker = Object.create(this.broker);
    this.broker.invoke = <T>(command: string, payload?: any) => originalInvoke(command, payload, id);
  }

  registerAction(action: ExtensionAction): void {
    ExtensionBridge.getInstance().registerAction(action.extensionId, action);

    // We shouldn't serialize the `execute` function for IPC, so we omit it
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
