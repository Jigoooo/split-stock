import { isPopoutRoute, type PopoutRoute } from '@shared/popout';

export { isPopoutRoute, type PopoutRoute };

export function readPopoutRoute(): PopoutRoute | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const match = /popout=([^&]+)/.exec(hash);
  if (!match) return null;
  const decoded = decodeURIComponent(match[1] ?? '');
  return isPopoutRoute(decoded) ? decoded : null;
}
