/** Response envelopes consumed by a dedicated host bridge instead of the request router. */
export const TIER2_TOOL_RESPONSE_TYPE = 'asyar:tools:invoke:response' as const;

export function isExternallyConsumedExtensionResponse(type: string): boolean {
  return type === TIER2_TOOL_RESPONSE_TYPE;
}
