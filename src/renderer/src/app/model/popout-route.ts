import { isPopoutRoute, type PopoutRoute } from '@shared/popout';

export { isPopoutRoute, type PopoutRoute };

function readLegacyPopoutRoute(hash: string): PopoutRoute | null {
  const match = /popout=([^&]+)/.exec(hash);
  if (!match) return null;
  const decoded = decodeURIComponent(match[1] ?? '');
  return isPopoutRoute(decoded) ? decoded : null;
}

function readHashPopoutRoute(hash: string): PopoutRoute | null {
  const match = /^#\/popout\/([^/?#]+)/.exec(hash);
  if (!match) return null;
  const decoded = decodeURIComponent(match[1] ?? '');
  return isPopoutRoute(decoded) ? decoded : null;
}

export function readPopoutRoute(): PopoutRoute | null {
  if (typeof window === 'undefined') return null;
  return readHashPopoutRoute(window.location.hash) ?? readLegacyPopoutRoute(window.location.hash);
}

export function toPopoutPath(route: PopoutRoute): string {
  return `/popout/${encodeURIComponent(route)}`;
}

export function normalizeLegacyPopoutHash(): void {
  if (typeof window === 'undefined') return;
  const route = readLegacyPopoutRoute(window.location.hash);
  if (route === null) return;

  const expected = `#${toPopoutPath(route)}`;
  if (window.location.hash === expected) return;

  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${expected}`,
  );
}

export function installLegacyPopoutHashBridge(): void {
  if (typeof window === 'undefined') return;

  normalizeLegacyPopoutHash();
  window.addEventListener('hashchange', normalizeLegacyPopoutHash);
}
