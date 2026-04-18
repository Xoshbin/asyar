import type { Component } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

const registry = new SvelteMap<string, Component>();

export function registerSettingsPanel(
  extensionId: string,
  component: Component
): void {
  registry.set(extensionId, component);
}

export function getSettingsPanel(extensionId: string): Component | undefined {
  return registry.get(extensionId);
}

export function hasSettingsPanel(extensionId: string): boolean {
  return registry.has(extensionId);
}

export function _clearSettingsPanelRegistryForTesting(): void {
  registry.clear();
}
