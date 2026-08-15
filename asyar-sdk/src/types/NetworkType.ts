export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number; // ms, default 30000
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
