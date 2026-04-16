import type { Namespace } from 'asyar-sdk';

export type ServiceRegistry = Record<Namespace, unknown>;

/**
 * Identity function whose job is to constrain registry keys at compile
 * time. Keys outside the `Namespace` union cause a type error. Runtime
 * cost: zero.
 */
export function defineServiceRegistry<T extends ServiceRegistry>(registry: T): T {
  return registry;
}
