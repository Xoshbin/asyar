import { StoreService } from "../../services/StoreService";

const storeService = new StoreService();

export const store = {
  get: <T>(storeName: string, key: string) =>
    storeService.get<T>(storeName, key),
  set: <T>(storeName: string, key: string, value: T) =>
    storeService.set(storeName, key, value),
  save: (storeName: string) => storeService.save(storeName),
  clear: (storeName: string) => storeService.clear(storeName),
  delete: (storeName: string, key: string) =>
    storeService.delete(storeName, key),
} as const;
