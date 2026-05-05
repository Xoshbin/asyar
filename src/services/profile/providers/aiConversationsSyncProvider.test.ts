import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIConversationsSyncProvider } from './aiConversationsSyncProvider';
import type { SyncProviderData } from '../types';

const mockConversations = [
  { id: 'conv1', messages: [], createdAt: 1000, title: 'Hello' },
  { id: 'conv2', messages: [], createdAt: 2000, title: 'World' },
];

vi.mock('../../../built-in-features/ai-chat/aiStore.svelte', () => {
  type ChangeCb = (e: { type: 'upsert' | 'delete'; itemId: string }) => void;
  const subscribers = new Set<ChangeCb>();
  return {
    aiStore: {
      conversationHistory: [
        { id: 'conv1', messages: [], createdAt: 1000, title: 'Hello' },
        { id: 'conv2', messages: [], createdAt: 2000, title: 'World' },
      ],
      deleteConversation: vi.fn(),
      subscribeToConversationChanges: vi.fn((cb: ChangeCb) => {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      }),
      __emit: (ev: { type: 'upsert' | 'delete'; itemId: string }) => {
        subscribers.forEach((cb) => cb(ev));
      },
    },
  };
});

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

  describe('exportItems returns one SyncItem per conversation', () => {
    it('one entry per conversation keyed by id', async () => {
      const items = await provider.exportItems();
      expect(items.length).toBe(2);
      expect(items[0].id).toBe('conv1');
      expect(items[0].categoryId).toBe('ai-conversations');
      expect(items[1].id).toBe('conv2');
    });
  });

  describe('applyItemUpsert appends or replaces in conversationHistory', () => {
    it('adds a new conversation', async () => {
      const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
      const content = { id: 'conv99', messages: [], createdAt: 9000, title: 'New' };
      await provider.applyItemUpsert({ id: 'conv99', categoryId: 'ai-conversations', content });
      expect(aiStore.conversationHistory.find((c) => c.id === 'conv99')).toBeDefined();
    });

    it('replaces an existing conversation by id', async () => {
      const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
      const content = { id: 'conv1', messages: [], createdAt: 1000, title: 'Updated' };
      await provider.applyItemUpsert({ id: 'conv1', categoryId: 'ai-conversations', content });
      const found = aiStore.conversationHistory.find((c) => c.id === 'conv1');
      expect(found?.title).toBe('Updated');
    });
  });

  describe('applyItemDelete routes to aiStore.deleteConversation', () => {
    it('calls deleteConversation with the id', async () => {
      const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
      await provider.applyItemDelete('conv1');
      expect((aiStore as unknown as { deleteConversation: ReturnType<typeof vi.fn> }).deleteConversation)
        .toHaveBeenCalledWith('conv1');
    });
  });

  describe('subscribeToChanges propagates store events', () => {
    it('relays upsert and delete events with categoryId', async () => {
      const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
      const unsub = provider.subscribeToChanges((ev) => events.push(ev));
      const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
      const emit = (aiStore as unknown as {
        __emit: (e: { type: 'upsert' | 'delete'; itemId: string }) => void;
      }).__emit;
      emit({ type: 'upsert', itemId: 'conv1' });
      emit({ type: 'delete', itemId: 'conv2' });

      expect(events).toEqual([
        { type: 'upsert', itemId: 'conv1', categoryId: 'ai-conversations' },
        { type: 'delete', itemId: 'conv2', categoryId: 'ai-conversations' },
      ]);
      unsub();
    });
  });
});
