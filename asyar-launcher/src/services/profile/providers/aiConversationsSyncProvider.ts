import { aiStore, type AIConversation } from '../../../built-in-features/ai-chat/aiStore.svelte';
import type { ISyncProvider, SyncProviderData, ImportPreview, ImportResult, DataSummary, ConflictStrategy } from '../types';

export class AIConversationsSyncProvider implements ISyncProvider {
  readonly id = 'ai-conversations';
  readonly displayName = 'AI Conversations';
  readonly icon = 'message-square';
  readonly syncTier = 'extended' as const;
  readonly defaultEnabled = false;
  readonly defaultConflictStrategy = 'merge' as const;
  readonly sensitiveFields: string[] = [];

  async exportFull(): Promise<SyncProviderData> {
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: aiStore.conversationHistory,
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    return this.exportFull();
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const local = aiStore.conversationHistory;
    const incomingItems = incoming.data as AIConversation[];
    const localIds = new Set(local.map(c => c.id));
    const incomingIds = new Set(incomingItems.map(c => c.id));

    return {
      localCount: local.length,
      incomingCount: incomingItems.length,
      conflicts: incomingItems.filter(c => localIds.has(c.id)).length,
      newItems: incomingItems.filter(c => !localIds.has(c.id)).length,
      removedItems: local.filter(c => !incomingIds.has(c.id)).length,
    };
  }

  async applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult> {
    const incomingItems = incoming.data as AIConversation[];

    if (strategy === 'skip') {
      return { success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    if (strategy === 'replace') {
      aiStore.conversationHistory = [...incomingItems];
      return { success: true, itemsAdded: incomingItems.length, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    // merge: dedup by id, add new conversations only
    const localIds = new Set(aiStore.conversationHistory.map(c => c.id));
    const newConversations = incomingItems.filter(c => !localIds.has(c.id));
    aiStore.conversationHistory = [...aiStore.conversationHistory, ...newConversations];

    return { success: true, itemsAdded: newConversations.length, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
  }

  async getLocalSummary(): Promise<DataSummary> {
    const count = aiStore.conversationHistory.length;
    return { itemCount: count, label: `${count} conversation(s)` };
  }
}
