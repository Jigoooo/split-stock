export type PopoutRoute = 'dashboard' | 'trade' | 'logs' | 'reports' | 'settings' | 'stock-picker';

export function isPopoutRoute(value: string): value is PopoutRoute {
  return (
    value === 'dashboard' ||
    value === 'trade' ||
    value === 'logs' ||
    value === 'reports' ||
    value === 'settings' ||
    value === 'stock-picker'
  );
}

export function readPopoutRoute(): PopoutRoute | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const match = /popout=([^&]+)/.exec(hash);
  if (!match) return null;
  const decoded = decodeURIComponent(match[1] ?? '');
  return isPopoutRoute(decoded) ? decoded : null;
}
