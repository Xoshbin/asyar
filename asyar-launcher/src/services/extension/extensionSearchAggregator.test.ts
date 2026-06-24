import { describe, it, expect, vi } from "vitest";

vi.mock("../log/logService", () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./extensionIframeManager.svelte", () => ({
  extensionIframeManager: {
    sendSearchRequestToExtension: vi.fn(),
  },
}));

vi.mock("../settings/settingsService.svelte", () => ({
  settingsService: {
    getSettings: vi.fn().mockReturnValue({
      search: { enableExtensionSearch: false },
    }),
  },
}));

import { ExtensionSearchAggregator } from "./extensionSearchAggregator";
import type { Extension, ExtensionResult } from "asyar-sdk/contracts";

function makeExtension(result: ExtensionResult): Extension {
  return {
    search: vi.fn().mockResolvedValue([result]),
  } as unknown as Extension;
}

function makeResult(title: string, score: number): ExtensionResult {
  return {
    title,
    score,
    type: "result",
    action: () => {},
  } as ExtensionResult;
}

describe("ExtensionSearchAggregator.searchAll", () => {
  it("does not re-sort results by score — final ordering belongs to Rust merged_search", async () => {
    const aggregator = new ExtensionSearchAggregator();
    const modulesById = new Map<string, Extension>([
      ["low-score-ext", makeExtension(makeResult("Low", 0.1))],
      ["high-score-ext", makeExtension(makeResult("High", 0.9))],
    ]);

    aggregator.init(
      modulesById,
      new Map(),
      () => true,
      () => {},
      new Map(),
    );

    const results = await aggregator.searchAll("test");

    expect(results.map((r) => r.title)).toEqual(["Low", "High"]);
  });
});
