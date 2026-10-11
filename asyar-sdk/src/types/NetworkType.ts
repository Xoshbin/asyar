export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number; // ms, default 30000
  /**
   * Names declared in `permissionArgs['network:secrets']` (requires `network` too).
   * The host injects the secret into the declared header; the token is never
   * visible to the extension and the response is redacted. Only declared exact
   * hosts over HTTPS are allowed, redirects are not followed, and requests are
   * GET-only unless other methods are declared. Empty/omitted references use
   * ordinary fetch without secret injection.
   */
  secretRefs?: string[];
}

export interface NetworkResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string; // always string — binary responses are base64 encoded
  ok: boolean;
}

export interface WebSocketOptions {
  headers?: Record<string, string>;
}

export interface IWebSocketHandle {
  readonly socketId: string;
  send(data: string): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
  onOpen(callback: () => void): () => void;
  onMessage(callback: (data: string) => void): () => void;
  onError(callback: (error: string) => void): () => void;
  onClose(callback: (info: { code?: number; reason?: string }) => void): () => void;
}

export interface INetworkService {
  fetch(url: string, options?: RequestOptions): Promise<NetworkResponse>;
  connectWebSocket(url: string, options?: WebSocketOptions): Promise<IWebSocketHandle>;
}
