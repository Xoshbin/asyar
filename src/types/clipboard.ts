export interface ClipboardHistoryItem {
  id: string;
  content: string;
  type: "text" | "image" | "html" | "rtf" | "files";
  timestamp: number;
}

export interface ClipboardHistoryState {
  items: ClipboardHistoryItem[];
  maxSize: number;
  retentionPeriodDays: number;
}
