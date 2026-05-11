import { registerProvider } from './providerRegistry';
import { openaiPlugin } from './providers/openai';
import { anthropicPlugin } from './providers/anthropic';
import { googlePlugin } from './providers/google';
import { ollamaPlugin } from './providers/ollama';
import { openrouterPlugin } from './providers/openrouter';
import { customPlugin } from './providers/custom';

export function initProviders(): void {
  registerProvider(openaiPlugin);
  registerProvider(anthropicPlugin);
  registerProvider(googlePlugin);
  registerProvider(ollamaPlugin);
  registerProvider(openrouterPlugin);
  registerProvider(customPlugin);
}
