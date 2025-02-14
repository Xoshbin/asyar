import { info } from "@tauri-apps/plugin-log";

export const log = {
  info: (message: string) => info(`[Extension] ${message}`),
  error: (message: string) => info(`[Extension Error] ${message}`),
} as const;
