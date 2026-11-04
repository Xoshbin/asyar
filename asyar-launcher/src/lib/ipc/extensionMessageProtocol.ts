/** Response envelopes consumed by a dedicated host bridge instead of the request router. */
export const TIER2_TOOL_RESPONSE_TYPE = 'asyar:tools:invoke:response' as const;
export const TIER2_WEB_SEARCH_RESPONSE_TYPE = 'asyar:webSearch:response' as const;
export const TIER2_AI_PROVIDER_CHUNK_TYPE = 'asyar:aiProvider:chunk' as const;
export const TIER2_AI_PROVIDER_COMPLETE_TYPE = 'asyar:aiProvider:complete' as const;
export const TIER2_AI_PROVIDER_ERROR_TYPE = 'asyar:aiProvider:error' as const;
export const TIER2_AI_PROVIDER_LIST_MODELS_RESPONSE_TYPE =
  'asyar:aiProvider:listModelsResponse' as const;

export function isExternallyConsumedExtensionResponse(type: string): boolean {
  return (
    type === TIER2_TOOL_RESPONSE_TYPE ||
    type === TIER2_WEB_SEARCH_RESPONSE_TYPE ||
    type === TIER2_AI_PROVIDER_CHUNK_TYPE ||
    type === TIER2_AI_PROVIDER_COMPLETE_TYPE ||
    type === TIER2_AI_PROVIDER_ERROR_TYPE ||
    type === TIER2_AI_PROVIDER_LIST_MODELS_RESPONSE_TYPE
  );
}
