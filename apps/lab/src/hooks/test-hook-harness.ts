import assert from 'node:assert/strict';
import React from 'react';

type Cleanup = () => void;
type EffectCreate = () => void | Cleanup;
interface Dispatcher {
  useState(init: unknown): [unknown, (next: unknown) => void];
  useRef(init: unknown): { current: unknown };
  useEffect(create: EffectCreate, deps?: readonly unknown[]): void;
  useCallback(fn: unknown): unknown;
  useDebugValue(): void;
  useSyncExternalStore(subscribe: (notify: () => void) => Cleanup, getSnapshot: () => unknown): unknown;
}

/** Small hook runner for node tests; exercises real hooks and Zustand stores without a DOM renderer. */
export function createHookHarness<T>(hook: () => T) {
  const shared = (React as unknown as Record<string, { H: Dispatcher | null }>)[
    '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE'
  ];
  assert.ok(shared, 'React shared internals unavailable');
  const stateSlots: { value: unknown; set: (next: unknown) => void }[] = [];
  const refSlots: { current: unknown }[] = [];
  const effectSlots: { deps?: readonly unknown[]; nextDeps?: readonly unknown[]; create: EffectCreate; cleanup?: Cleanup; ran: boolean }[] = [];
  const externalSlots: { subscribe: (notify: () => void) => Cleanup; unsubscribe: Cleanup }[] = [];
  let cursor = 0;
  let result!: T;
  let rendering = false;
  let queued = false;
  const render = () => {
    if (rendering) { queued = true; return; }
    rendering = true;
    cursor = 0;
    shared.H = dispatcher;
    try { result = hook(); } finally { shared.H = null; rendering = false; }
    for (const effect of effectSlots) {
      if (!effect) continue;
      const deps = effect.nextDeps;
      const changed = !effect.ran || deps === undefined || effect.deps === undefined
        || deps.length !== effect.deps.length
        || deps.some((dep, index) => !Object.is(dep, effect.deps?.[index]));
      if (!changed) continue;
      effect.ran = true;
      effect.deps = deps;
      effect.cleanup?.();
      const cleanup = effect.create();
      effect.cleanup = typeof cleanup === 'function' ? cleanup as Cleanup : undefined;
    }
    if (queued) { queued = false; render(); }
  };
  const dispatcher: Dispatcher = {
    useState(init) {
      const index = cursor++;
      if (!stateSlots[index]) {
        const slot = {
          value: typeof init === 'function' ? (init as () => unknown)() : init,
          set: (next: unknown) => {
            slot.value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(slot.value) : next;
            render();
          },
        };
        stateSlots[index] = slot;
      }
      const slot = stateSlots[index];
      return [slot.value, slot.set];
    },
    useRef(init) {
      const index = cursor++;
      if (!refSlots[index]) refSlots[index] = { current: init };
      return refSlots[index];
    },
    useEffect(create, deps) {
      const index = cursor++;
      const slot = effectSlots[index];
      if (slot) { slot.create = create; slot.nextDeps = deps; }
      else effectSlots[index] = { create, nextDeps: deps, ran: false };
    },
    useCallback: fn => fn,
    useDebugValue: () => {},
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor++;
      const slot = externalSlots[index];
      if (!slot || slot.subscribe !== subscribe) {
        slot?.unsubscribe();
        externalSlots[index] = { subscribe, unsubscribe: subscribe(render) };
      }
      return getSnapshot();
    },
  };
  render();
  return {
    get result() { return result; },
    unmount() {
      for (const effect of effectSlots) effect?.cleanup?.();
      for (const slot of externalSlots) slot?.unsubscribe();
    },
  };
}
