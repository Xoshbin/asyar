import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

export const clipboard = {
  async read(): Promise<string> {
    return await readText();
  },

  async write(text: string): Promise<void> {
    await writeText(text);
  },

  async copy(text: string): Promise<boolean> {
    try {
      await writeText(text);
      return true;
    } catch {
      return false;
    }
  },
} as const;
