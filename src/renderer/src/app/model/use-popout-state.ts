import { useEffect, useState } from 'react';
import type { PopoutRoute } from './popout-route';

export interface PopoutApi {
  isOpen: (route: PopoutRoute) => boolean;
  popout: (route: PopoutRoute) => Promise<void>;
}

/**
 * 앱 단일 인스턴스에서 팝아웃 창 상태를 추적한다.
 * 별도 provider 없이 App 루트에서 한 번만 생성해 props 로 전달한다.
 */
export function usePopoutState(): PopoutApi {
  const [openRoutes, setOpenRoutes] = useState<Set<PopoutRoute>>(() => new Set());

  useEffect(() => {
    const shell = window.appShell;
    if (!shell) return;
    return shell.onPopoutClosed((route) => {
      setOpenRoutes((prev) => {
        if (!prev.has(route as PopoutRoute)) return prev;
        const next = new Set(prev);
        next.delete(route as PopoutRoute);
        return next;
      });
    });
  }, []);

  const isOpen = (route: PopoutRoute): boolean => openRoutes.has(route);

  const popout = async (route: PopoutRoute): Promise<void> => {
    const shell = window.appShell;
    if (!shell) return;
    const result = await shell.openPopout(route);
    if (!result.ok) return;

    setOpenRoutes((prev) => {
      if (prev.has(route)) return prev;
      const next = new Set(prev);
      next.add(route);
      return next;
    });
  };

  return { isOpen, popout };
}
