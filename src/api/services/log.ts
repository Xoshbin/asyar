import { info } from "@tauri-apps/plugin-log";

export const log = {
  info: (message: string) => info(`[Plugin] ${message}`),
  error: (message: string) => info(`[Plugin Error] ${message}`),
} as const;
