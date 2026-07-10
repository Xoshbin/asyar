import type { IScreenService, PickedColor } from './IScreenService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK proxy for the screen sampling (eyedropper) service.
 */
export class ScreenServiceProxy extends BaseServiceProxy implements IScreenService {
  async pickColor(): Promise<PickedColor | null> {
    return this.broker.invoke<PickedColor | null>('screen:pickColor', {});
  }
}
