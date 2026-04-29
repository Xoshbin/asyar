import type { IOnboardingService } from './IOnboardingService';
import { BaseServiceProxy } from './BaseServiceProxy';

export class OnboardingServiceProxy extends BaseServiceProxy implements IOnboardingService {
  async complete(): Promise<void> {
    return this.broker.invoke<void>('onboarding:complete', {});
  }
}
