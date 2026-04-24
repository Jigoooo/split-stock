import { useEffect } from 'react';
import { overlayStackActions, useOverlayStackStore } from '../lib/overlay-stack';

export function OverlayStackManager() {
  useEffect(() => {
    const handlePopState = (event: PopStateEvent): void => {
      const { pendingBacks } = useOverlayStackStore.getState();
      if (pendingBacks > 0) {
        overlayStackActions.decrementPendingBacks();
        return;
      }

      const top = overlayStackActions.peek();
      if (!top && event.state?.modalId) {
        window.history.back();
        return;
      }

      if (!top) return;

      const popped = overlayStackActions.pop();
      popped?.resolve(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return null;
}
