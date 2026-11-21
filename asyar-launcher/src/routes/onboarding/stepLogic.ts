import { onboardingService } from '../../services/onboarding/onboardingService.svelte';
import { fetchAllStoreItems } from '../../built-in-features/store/storeFetch';
import {
  getInstallCount,
  isStoreTheme,
  type ApiExtension,
} from '../../built-in-features/store/state.svelte';

export async function advanceStep(): Promise<void> {
  await onboardingService.advance();
}

export async function goBackStep(): Promise<void> {
  await onboardingService.goBack();
}

export async function completeStep(): Promise<void> {
  await onboardingService.complete();
}

export async function fetchTopThemes(limit: number): Promise<ApiExtension[]> {
  try {
    const all = await fetchAllStoreItems();
    return all
      .filter(isStoreTheme)
      .sort((a, b) => getInstallCount(b) - getInstallCount(a))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchTopExtensions(limit: number, platform: string): Promise<ApiExtension[]> {
  try {
    const all = await fetchAllStoreItems();
    return all
      .filter((it) => !isStoreTheme(it))
      .filter((it) => {
        const p = it.manifest?.platforms;
        return !p?.length || p.includes(platform);
      })
      .sort((a, b) => getInstallCount(b) - getInstallCount(a))
      .slice(0, limit);
  } catch {
    return [];
  }
}
