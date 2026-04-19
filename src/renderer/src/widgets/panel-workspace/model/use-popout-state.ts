import { useCallback, useEffect, useState } from 'react';

export type PopoutRoute = 'dashboard' | 'trade' | 'logs' | 'reports' | 'settings';

export interface PopoutApi {
  isOpen: (route: PopoutRoute) => boolean;
  popout: (route: PopoutRoute) => Promise<void>;
}

/**
 * 팝아웃 창 개폐 상태를 렌더러에 추적 유지.
 * - main 프로세스가 'appShell:popout-closed' 이벤트로 닫힘을 통지하면 로컬 상태에서 제거.
 * - window.appShell이 없는 환경(테스트/미로드)에서는 stub 반환.
 */
export function usePopoutState(): PopoutApi {
  const [openRoutes, setOpenRoutes] = useState<Set<PopoutRoute>>(() => new Set());

  useEffect(() => {
    const shell = window.appShell;
    if (!shell) return;
    const dispose = shell.onPopoutClosed((route) => {
      setOpenRoutes((prev) => {
        if (!prev.has(route as PopoutRoute)) return prev;
        const next = new Set(prev);
        next.delete(route as PopoutRoute);
        return next;
      });
    });
    return dispose;
  }, []);

  const isOpen = useCallback((route: PopoutRoute) => openRoutes.has(route), [openRoutes]);
  const popout = useCallback(async (route: PopoutRoute): Promise<void> => {
    const shell = window.appShell;
    if (!shell) return;
    const r = await shell.openPopout(route);
    if (r.ok) {
      setOpenRoutes((prev) => {
        if (prev.has(route)) return prev;
        const next = new Set(prev);
        next.add(route);
        return next;
      });
    }
  }, []);

  return { isOpen, popout };
}
