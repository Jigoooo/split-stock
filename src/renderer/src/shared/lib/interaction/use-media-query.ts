import { useSyncExternalStore } from 'react';

const storeCache = new Map<string, ReturnType<typeof createMediaQueryStore>>();

function createMediaQueryStore(query: string, serverDefault = false) {
  const listeners = new Set<() => void>();
  let mediaQueryList: MediaQueryList | null = null;
  let refCount = 0;
  const isClient = typeof window !== 'undefined';
  const supportsMatchMedia = isClient && typeof window.matchMedia === 'function';

  const handleChange = () => {
    listeners.forEach((listener) => {
      listener();
    });
  };

  const subscribe = (listener: () => void) => {
    if (!supportsMatchMedia) return () => {};

    mediaQueryList ??= window.matchMedia(query);
    listeners.add(listener);

    if (refCount === 0) {
      mediaQueryList.addEventListener('change', handleChange);
    }
    refCount += 1;

    return () => {
      listeners.delete(listener);
      refCount -= 1;
      if (refCount === 0) {
        mediaQueryList?.removeEventListener('change', handleChange);
      }
    };
  };

  const getSnapshot = () => {
    if (!supportsMatchMedia) return serverDefault;
    mediaQueryList ??= window.matchMedia(query);
    return mediaQueryList.matches;
  };

  const getServerSnapshot = () => serverDefault;

  return { subscribe, getSnapshot, getServerSnapshot };
}

export function useMediaQuery(query: string): boolean {
  let store = storeCache.get(query);
  if (!store) {
    store = createMediaQueryStore(query, false);
    storeCache.set(query, store);
  }

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
