import { AsyncLocalStorage } from 'node:async_hooks';
import type { FactoryProvider, InjectionToken } from '@nestjs/common';

export type BootstrapBinding = readonly [key: symbol, value: unknown];

const bindingsByStartup = new AsyncLocalStorage<ReadonlyMap<symbol, unknown>>();

/** Supply pre-initialized instances to eager singleton providers during Nest startup. */
export async function withBootstrapBindings<T>(
  bindings: readonly BootstrapBinding[],
  start: () => Promise<T>,
): Promise<T> {
  const values = new Map(bindings);
  if (values.size !== bindings.length)
    throw new Error('DUPLICATE_BOOTSTRAP_BINDING');
  try {
    return await bindingsByStartup.run(values, start);
  } finally {
    values.clear();
  }
}

/** Each declaration owns a private key and exposes its instance through Nest DI. */
export function bootstrapBinding<T>(provide: InjectionToken<T>): {
  provider: FactoryProvider<T>;
  bind(value: T): BootstrapBinding;
} {
  const key = Symbol('bootstrap binding');
  return {
    provider: {
      provide,
      useFactory() {
        const values = bindingsByStartup.getStore();
        if (!values?.has(key)) throw new Error('MISSING_BOOTSTRAP_BINDING');
        // Only this declaration's typed bind() can populate its private key.
        return values.get(key) as T;
      },
    },
    bind: (value) => [key, value],
  };
}
