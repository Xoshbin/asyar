/**
 * Extension key-value storage service.
 *
 * Each extension gets its own isolated namespace — extensions cannot read
 * or write other extensions' data. Values are JSON-serialized strings stored
 * in SQLite on the Rust side.
 *
 * Requires `storage:read` / `storage:write` permissions in manifest.json.
 */
export interface IStorageService {
  /** Get a value by key. Returns null if the key does not exist. */
  get(key: string): Promise<string | null>;

  /** Set a key-value pair. Overwrites if the key already exists. */
  set(key: string, value: string): Promise<void>;

  /** Delete a key. Returns true if the key existed. */
  delete(key: string): Promise<boolean>;

  /** Get all key-value pairs for this extension. */
  getAll(): Promise<Record<string, string>>;

  /** Delete all stored data for this extension. */
  clear(): Promise<number>;
}
