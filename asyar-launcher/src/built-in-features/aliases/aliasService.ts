import * as commands from '../../lib/ipc/commands';
import type { ItemAlias, AliasConflict } from '../../bindings';

/**
 * Thin Tauri proxy for the alias subsystem. The Rust side owns storage,
 * validation, and conflict detection — this class is just a typed wrapper
 * around five IPC commands. Module-singleton per the launcher's
 * service-singletons skill.
 */
export class AliasService {
  async register(
    objectId: string,
    alias: string,
    itemName: string,
    itemType: 'application' | 'command'
  ): Promise<ItemAlias> {
    return commands.setAlias(objectId, alias, itemName, itemType);
  }

  async unregister(alias: string): Promise<void> {
    await commands.unsetAlias(alias);
  }

  async list(): Promise<ItemAlias[]> {
    return commands.listAliases();
  }

  async findConflict(
    alias: string,
    excludingObjectId?: string
  ): Promise<AliasConflict | null> {
    return commands.findAliasConflict(alias, excludingObjectId);
  }
}

export const aliasService = new AliasService();
