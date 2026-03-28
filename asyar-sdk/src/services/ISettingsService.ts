export interface ISettingsService {
  /**
   * Get a specific setting value
   * @param section The settings section (e.g. 'general', 'calculator')
   * @param key The specific key within that section
   */
  get<T>(section: string, key: string): Promise<T>;

  /**
   * Update a setting value
   * @param section The settings section
   * @param key The specific key
   * @param value The new value
   */
  set<T>(section: string, key: string, value: T): Promise<void>;

  /**
   * Register a listener for settings changes
   * @param section The section to watch
   * @param callback Function called when any value in that section changes
   */
  onChanged<T>(section: string, callback: (settings: T) => void): () => void;
}
