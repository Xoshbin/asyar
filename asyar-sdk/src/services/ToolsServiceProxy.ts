import { BaseServiceProxy } from './BaseServiceProxy';
import type { IToolsService, ManifestTool, ToolDescriptor, ToolHandler } from '../contracts/tools';

/** SDK-side proxy for the Tools service. */
export class ToolsServiceProxy extends BaseServiceProxy implements IToolsService {
  private handlers = new Map<string, ToolHandler>();

  async registerTool(tool: ManifestTool, handler: ToolHandler): Promise<void> {
    this.handlers.set(tool.id, handler);
    return this.broker.invoke('tools:registerTool', { tool });
  }

  async unregisterTool(id: string): Promise<void> {
    const result = await this.broker.invoke<void>('tools:unregisterTool', { id });
    this.handlers.delete(id);
    return result;
  }

  async listTools(): Promise<ToolDescriptor[]> {
    return this.broker.invoke<ToolDescriptor[]>('tools:listTools');
  }

  async invokeHandler(id: string, args: unknown): Promise<unknown> {
    const handler = this.handlers.get(id);
    if (!handler) {
      throw new Error(`[asyar-sdk/tools] No handler registered for tool id: "${id}"`);
    }
    return handler(args);
  }
}
