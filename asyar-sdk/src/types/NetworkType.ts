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

export interface INetworkService {
  fetch(url: string, options?: RequestOptions): Promise<NetworkResponse>;
}
