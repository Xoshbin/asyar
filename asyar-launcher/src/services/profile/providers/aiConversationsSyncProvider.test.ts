import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIConversationsSyncProvider } from './aiConversationsSyncProvider';
import type { SyncProviderData } from '../types';

const mockConversations = [
  { id: 'conv1', messages: [], createdAt: 1000, title: 'Hello' },
  { id: 'conv2', messages: [], createdAt: 2000, title: 'World' },
];

vi.mock('../../../built-in-features/ai-chat/aiStore.svelte', () => ({
  aiStore: { conversationHistory: [
    { id: 'conv1', messages: [], createdAt: 1000, title: 'Hello' },
    { id: 'conv2', messages: [], createdAt: 2000, title: 'World' },
  ] },
}));

describe('AIConversationsSyncProvider', () => {
  let provider: AIConversationsSyncProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new AIConversationsSyncProvider();
    // Reset mutable mock state before each test
    const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
    aiStore.conversationHistory = [
      { id: 'conv1', messages: [], createdAt: 1000, title: 'Hello' },
      { id: 'conv2', messages: [], createdAt: 2000, title: 'World' },
    ];
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('ai-conversations');
    expect(provider.syncTier).toBe('extended');
    expect(provider.defaultEnabled).toBe(false);
    expect(provider.defaultConflictStrategy).toBe('merge');
    expect(provider.sensitiveFields).toEqual([]);
  });

  it('exportFull returns all conversations', async () => {
    const result = await provider.exportFull();
    expect(result.providerId).toBe('ai-conversations');
    expect(result.version).toBe(1);
    const data = result.data as any[];
    expect(data.length).toBe(2);
    expect(result.binaryAssets).toBeUndefined();
  });

  it('preview calculates stats', async () => {
    const incoming: SyncProviderData = {
      providerId: 'ai-conversations',
      version: 1,
      exportedAt: Date.now(),
      data: [
        { id: 'conv1', messages: [], createdAt: 1000, title: 'Hello' },
        { id: 'conv3', messages: [], createdAt: 3000, title: 'New' },
      ],
    };

    const preview = await provider.preview(incoming);
    expect(preview.localCount).toBe(2);
    expect(preview.incomingCount).toBe(2);
    expect(preview.conflicts).toBe(1); // conv1 in both
    expect(preview.newItems).toBe(1);  // conv3 is new
    expect(preview.removedItems).toBe(1); // conv2 only local
  });

  it('applyImport replace — replaces all conversations', async () => {
    const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
    const newConversations = [
      { id: 'conv10', messages: [], createdAt: 9000, title: 'Fresh' },
    ];
    const incoming: SyncProviderData = {
      providerId: 'ai-conversations',
      version: 1,
      exportedAt: Date.now(),
      data: newConversations,
    };

    const result = await provider.applyImport(incoming, 'replace');
    expect(result.success).toBe(true);
    expect(result.itemsAdded).toBe(1);
    expect(aiStore.conversationHistory).toEqual(newConversations);
  });

  it('applyImport merge — adds only new conversations', async () => {
    const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
    const incoming: SyncProviderData = {
      providerId: 'ai-conversations',
      version: 1,
      exportedAt: Date.now(),
      data: [
        { id: 'conv1', messages: [], createdAt: 1000, title: 'Hello' }, // existing
        { id: 'conv3', messages: [], createdAt: 3000, title: 'New' },   // new
      ],
    };

    const initialLength = aiStore.conversationHistory.length;
    const result = await provider.applyImport(incoming, 'merge');
    expect(result.itemsAdded).toBe(1);
    expect(aiStore.conversationHistory.length).toBe(initialLength + 1);
  });

  it('applyImport skip — does nothing', async () => {
    const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
    const initialLength = aiStore.conversationHistory.length;
    const incoming: SyncProviderData = {
      providerId: 'ai-conversations',
      version: 1,
      exportedAt: Date.now(),
      data: [{ id: 'conv99', messages: [], createdAt: 1, title: 'Skip me' }],
    };

    const result = await provider.applyImport(incoming, 'skip');
    expect(result.itemsAdded).toBe(0);
    expect(result.itemsUpdated).toBe(0);
    expect(aiStore.conversationHistory.length).toBe(initialLength);
  });

  it('getLocalSummary returns correct count', async () => {
    const summary = await provider.getLocalSummary();
    expect(summary.itemCount).toBe(2);
    expect(summary.label).toBe('2 conversation(s)');
  });
});
