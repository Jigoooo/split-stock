import { useEffect, useRef, useState } from 'react';

function isPopoutWindow(): boolean {
  return window.location.hash.startsWith('#/popout/');
}

export function usePopoutVisibility(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!isPopoutWindow()) return;
    const offVisibility = window.appShell?.onPopoutVisibilityChanged?.((_route, nextVisible) => {
      setVisible(nextVisible);
    });
    const offActivated = window.appShell?.onPopoutActivated?.(() => {
      setVisible(true);
    });
    return () => {
      offVisibility?.();
      offActivated?.();
    };
  }, []);

  return visible;
}

export function usePopoutActivationKey(route: string): number {
  const [activationKey, setActivationKey] = useState(0);

  useEffect(() => {
    if (!isPopoutWindow()) return;
    return window.appShell?.onPopoutActivated?.((activatedRoute) => {
      if (activatedRoute !== route) return;
      setActivationKey((current) => current + 1);
    });
  }, [route]);

  return activationKey;
}

export function useLatestPopoutVisibility(): { current: boolean } {
  const visible = usePopoutVisibility();
  const visibleRef = useRef(visible);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  return visibleRef;
}
