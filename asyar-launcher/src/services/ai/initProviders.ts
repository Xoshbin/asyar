import { providerRegistry } from './providerRegistry';
import { aiListModels } from '../../lib/ipc/commands';
import type { IProviderPlugin, ProviderId } from './IProviderPlugin';

const ALL_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

function descriptor(
  metadata: Omit<IProviderPlugin, 'getModels'> & { id: ProviderId },
): IProviderPlugin {
  return {
    ...metadata,
    getModels: (config) => aiListModels(metadata.id, config),
  };
}

const PROVIDERS: IProviderPlugin[] = [
  descriptor({
    id: 'openai',
    name: 'OpenAI',
    requiresApiKey: true,
    requiresBaseUrl: false,
    supportsOpenAIApiMode: true,
    supportsHostedWebSearch: true,
  }),
  descriptor({
    id: 'anthropic',
    name: 'Anthropic',
    requiresApiKey: true,
    requiresBaseUrl: false,
  }),
  descriptor({
    id: 'google',
    name: 'Google Gemini',
    requiresApiKey: true,
    requiresBaseUrl: false,
    reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
  }),
  descriptor({
    id: 'ollama',
    name: 'Ollama (local)',
    requiresApiKey: false,
    requiresBaseUrl: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  }),
  descriptor({
    id: 'openrouter',
    name: 'OpenRouter',
    requiresApiKey: true,
    requiresBaseUrl: false,
    reasoningEfforts: ALL_REASONING_EFFORTS,
  }),
  descriptor({
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    requiresApiKey: false,
    optionalApiKey: true,
    requiresBaseUrl: true,
    supportsOpenAIApiMode: true,
    supportsHostedWebSearch: true,
    reasoningEfforts: ALL_REASONING_EFFORTS,
  }),
];

export function initProviders(): void {
  for (const provider of PROVIDERS) providerRegistry.register(provider);
}
