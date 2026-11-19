import type {
  EnvironmentPaths,
  EnvironmentSnapshot,
  IEnvironmentService,
} from '../types/EnvironmentType';
import { BaseServiceProxy } from './BaseServiceProxy';

export class EnvironmentServiceProxy extends BaseServiceProxy implements IEnvironmentService {
  async getEnvironment(): Promise<EnvironmentSnapshot> {
    return this.broker.invoke<EnvironmentSnapshot>('environment:getEnvironment');
  }

  async getPaths(): Promise<EnvironmentPaths> {
    return this.broker.invoke<EnvironmentPaths>('environment:getPaths');
  }
}
