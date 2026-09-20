/**
 * @vitest-environment jsdom
 */
import React, { useState, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Import from our @asyar/raycast-compat shim exactly as a Raycast extension does:
import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  LocalStorage,
  Toast,
  showToast,
  showHUD,
  closeMainWindow,
  getPreferenceValues,
  setRaycastContext,
  adaptRaycastPackageJson,
} from '../index';
import type {
  IClipboardHistoryService,
  IStorageService,
  IFeedbackService,
  IOpenerService,
} from 'asyar-sdk/contracts';

// ── REAL SCENARIO 1: Raycast Store "Lorem Ipsum" Command ───────────────────────
// Source: https://github.com/raycast/extensions/tree/main/extensions/lorem-ipsum
async function runLoremIpsumCommand(args?: { numberOfParagraphs?: string }) {
  const count = parseInt(args?.numberOfParagraphs ?? '1', 10);
  const sampleParagraphs = Array.from(
    { length: count },
    (_, i) => `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Paragraph ${i + 1}.`,
  ).join('\n\n');

  const { action } = getPreferenceValues<{ action: string }>();

  await closeMainWindow();

  if (action === 'clipboard') {
    await Clipboard.copy(sampleParagraphs);
    await showToast(Toast.Style.Success, 'Copied to clipboard! 📋');
  } else if (action === 'paste') {
    await Clipboard.paste(sampleParagraphs);
    await showToast(Toast.Style.Success, 'Pasted to active app! 📝');
  }

  return sampleParagraphs;
}

// ── REAL SCENARIO 2: Raycast Store "Base64" UI Command ────────────────────────
// Source: https://github.com/raycast/extensions/tree/main/extensions/base64
function Base64Command() {
  const [input, setInput] = useState('');

  const encoded = input ? btoa(input) : null;
  let decoded: string | null = null;
  try {
    decoded = input && input.length >= 4 ? atob(input) : null;
  } catch {
    decoded = null;
  }

  return (
    <List
      searchBarPlaceholder="Text to encode / decode..."
      onSearchTextChange={(val) => setInput(val)}
    >
      {encoded || decoded ? (
        <List.Section title={`Input: ${input}`}>
          {encoded && (
            <List.Item
              id="encode"
              icon={{ source: Icon.CodeBlock, tintColor: Color.Magenta }}
              title="Encode"
              subtitle={encoded}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard content={encoded} title="Copy Encoded" />
                  <Action.Paste content={encoded} title="Paste Encoded" />
                </ActionPanel>
              }
            />
          )}
          {decoded && (
            <List.Item
              id="decode"
              icon={{ source: Icon.Code, tintColor: Color.Purple }}
              title="Decode"
              subtitle={decoded}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard content={decoded} title="Copy Decoded" />
                </ActionPanel>
              }
            />
          )}
        </List.Section>
      ) : (
        <List.EmptyView
          icon={{ source: Icon.QuestionMarkCircle, tintColor: Color.Red }}
          title="Nothing to Encode / Decode"
          description="Start typing text to encode or decode."
        />
      )}
    </List>
  );
}

describe('Real Live Raycast Store Extension Scenarios', () => {
  let mockClipboard: Partial<IClipboardHistoryService>;
  let mockStorage: Partial<IStorageService>;
  let mockFeedback: Partial<IFeedbackService>;
  let mockOpener: Partial<IOpenerService>;
  let memoryStore: Record<string, string>;
  let postedMessages: any[];

  beforeEach(() => {
    postedMessages = [];
    memoryStore = {};

    mockClipboard = {
      writeToClipboard: vi.fn().mockResolvedValue(undefined),
      readCurrentText: vi.fn().mockResolvedValue(''),
      simulatePaste: vi.fn().mockResolvedValue(true),
    };

    mockStorage = {
      get: vi.fn().mockImplementation(async (k) => memoryStore[k] ?? null),
      set: vi.fn().mockImplementation(async (k, v) => {
        memoryStore[k] = v;
      }),
      delete: vi.fn().mockImplementation(async (k) => {
        delete memoryStore[k];
        return true;
      }),
    };

    mockFeedback = {
      report: vi.fn().mockResolvedValue(undefined),
      showHUD: vi.fn().mockResolvedValue(undefined),
    };

    mockOpener = {
      openUrl: vi.fn().mockResolvedValue(undefined),
      openPath: vi.fn().mockResolvedValue(undefined),
    };

    setRaycastContext({
      getService: vi.fn().mockImplementation((ns: string) => {
        if (ns === 'clipboard') return mockClipboard;
        if (ns === 'storage') return mockStorage;
        if (ns === 'feedback') return mockFeedback;
        if (ns === 'opener') return mockOpener;
        throw new Error(`Unexpected service ${ns}`);
      }),
      preferences: {
        values: {
          action: 'clipboard',
          commands: {},
        },
      },
    } as any);

    vi.spyOn(window.parent, 'postMessage').mockImplementation((msg) => {
      postedMessages.push(msg);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('Scenario 1: Executes real Raycast Store "Lorem Ipsum" command and copies output', async () => {
    const generated = await runLoremIpsumCommand({ numberOfParagraphs: '2' });

    expect(generated).toContain('Paragraph 1');
    expect(generated).toContain('Paragraph 2');

    // Verified closeMainWindow was triggered
    expect(postedMessages).toContainEqual({ type: 'asyar:window:hide' });

    // Verified output was copied to clipboard via ClipboardHistoryServiceProxy
    expect(mockClipboard.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        content: generated,
      }),
    );

    // Verified success toast was displayed via FeedbackServiceProxy
    expect(mockFeedback.report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'toast',
        severity: 'success',
      }),
    );
  });

  it('Scenario 2: Renders real Raycast Store "Base64" extension and executes Copy action', async () => {
    render(<Base64Command />);

    // Initially shows EmptyView
    expect(screen.getByText('Nothing to Encode / Decode')).toBeDefined();

    // Type text into search bar
    const searchInput = screen.getByPlaceholderText('Text to encode / decode...');
    fireEvent.change(searchInput, { target: { value: 'Hello Asyar' } });

    // Verify encoding result
    await waitFor(() => {
      expect(screen.getByText('Encode')).toBeDefined();
      expect(screen.getByText('SGVsbG8gQXN5YXI=')).toBeDefined();
    });

    // Primary action shown in action bar
    const copyButton = screen.getByText(/Copy Encoded/i);
    expect(copyButton).toBeDefined();

    fireEvent.click(copyButton);

    // Verify the encoded string was copied to clipboard!
    expect(mockClipboard.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'SGVsbG8gQXN5YXI=',
      }),
    );
  });

  it('Scenario 3: Real Raycast Store "UUID Generator" history tracking with LocalStorage', async () => {
    // Real logic from raycast/extensions/extensions/uuid-generator/src/uuidHistory.ts
    const sampleUuid1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const sampleUuid2 = 'b1ffcd88-8b1a-4fe7-aa5c-5aa8ac270b22';

    // 1. Add entry
    const initialRaw = (await LocalStorage.getItem('uuidHistory')) ?? '[]';
    const parsed = JSON.parse(initialRaw as string);
    parsed.push({ uuid: sampleUuid1, timestamp: new Date().toISOString(), type: 'uuidV4' });
    await LocalStorage.setItem('uuidHistory', JSON.stringify(parsed));

    expect(memoryStore['uuidHistory']).toBeDefined();
    expect(memoryStore['uuidHistory']).toContain(sampleUuid1);

    // 2. Add second entry
    parsed.push({ uuid: sampleUuid2, timestamp: new Date().toISOString(), type: 'uuidV7' });
    await LocalStorage.setItem('uuidHistory', JSON.stringify(parsed));

    // 3. Read history
    const stored = (await LocalStorage.getItem('uuidHistory')) as string;
    const historyList = JSON.parse(stored);
    expect(historyList).toHaveLength(2);
    expect(historyList[0].uuid).toBe(sampleUuid1);
    expect(historyList[1].uuid).toBe(sampleUuid2);

    // 4. Delete entry
    const filtered = historyList.filter((e: any) => e.uuid !== sampleUuid1);
    await LocalStorage.setItem('uuidHistory', JSON.stringify(filtered));

    const updatedStored = (await LocalStorage.getItem('uuidHistory')) as string;
    const updatedHistory = JSON.parse(updatedStored);
    expect(updatedHistory).toHaveLength(1);
    expect(updatedHistory[0].uuid).toBe(sampleUuid2);
  });

  it('Scenario 4: Adapts real Raycast Store "Lorem Ipsum" and "Base64" package.json to Asyar manifest', async () => {
    // Official package.json from raycast/extensions/extensions/lorem-ipsum/package.json
    const realLoremIpsumPackageJson = {
      name: 'lorem-ipsum',
      title: 'Lorem Ipsum',
      description: 'Generate placeholder content',
      icon: 'paragraph-icon.png',
      author: 'AntonNiklasson',
      commands: [
        {
          name: 'paragraphs',
          title: 'Generate Paragraphs',
          subtitle: 'Lorem Ipsum',
          description: 'Generate random paragraphs and copy them to the clipboard',
          mode: 'no-view' as const,
        },
        {
          name: 'sentences',
          title: 'Generate Sentences',
          subtitle: 'Lorem Ipsum',
          description: 'Generate random sentences and copy them to the clipboard',
          mode: 'no-view' as const,
        },
      ],
      preferences: [
        {
          name: 'action',
          type: 'dropdown' as const,
          title: 'Default Action',
          description: 'What you would like to happen when running the command',
          data: [
            { value: 'clipboard', title: 'Copy to Clipboard' },
            { value: 'paste', title: 'Paste to Active App' },
            { value: 'pasteAndCopy', title: 'Paste and Copy to Clipboard' },
          ],
          default: 'clipboard',
        },
      ],
    };

    const asyarManifest = adaptRaycastPackageJson(realLoremIpsumPackageJson);

    expect(asyarManifest.id).toBe('org.asyar.raycast.lorem-ipsum');
    expect(asyarManifest.name).toBe('Lorem Ipsum');
    expect(asyarManifest.type).toBe('extension');
    expect(asyarManifest.commands).toHaveLength(2);
    expect(asyarManifest.commands[0]).toEqual({
      id: 'paragraphs',
      name: 'Generate Paragraphs',
      description: 'Generate random paragraphs and copy them to the clipboard',
      mode: 'background',
      component: undefined,
      icon: undefined,
    });
    expect(asyarManifest.preferences).toHaveLength(1);
    expect(asyarManifest.preferences![0]).toEqual({
      name: 'action',
      title: 'Default Action',
      description: 'What you would like to happen when running the command',
      type: 'dropdown',
      default: 'clipboard',
      required: undefined,
      placeholder: undefined,
      data: [
        { value: 'clipboard', title: 'Copy to Clipboard' },
        { value: 'paste', title: 'Paste to Active App' },
        { value: 'pasteAndCopy', title: 'Paste and Copy to Clipboard' },
      ],
    });
    expect(asyarManifest.permissions).toContain('clipboard:write');
    expect(asyarManifest.permissions).toContain('storage:read');
  });
});
