import { ExtensionBridge } from "../ExtensionBridge";

// Component proxy factory function
function createComponentProxy(componentName: string) {
  return function (...args: any[]) {
    const bridge = ExtensionBridge.getInstance();
    const component = bridge.getComponent(componentName);

    if (!component) {
      console.error(`Component ${componentName} is not registered`);
      return null;
    }

    return component(...args);
  };
}

// Export proxied components
export const Button = createComponentProxy("Button");
export const Input = createComponentProxy("Input");
export const Card = createComponentProxy("Card");
export const Toggle = createComponentProxy("Toggle");
export const SplitView = createComponentProxy("SplitView");
export const ShortcutRecorder = createComponentProxy("ShortcutRecorder");
export const ConfirmDialog = createComponentProxy("ConfirmDialog");
