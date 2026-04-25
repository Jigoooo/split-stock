import { type Drawing, getDrawingStorageKey } from '../model/drawing-types';

export const randomId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const readPersisted = (pdno: string): Drawing[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getDrawingStorageKey(pdno));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Drawing[]) : [];
  } catch {
    return [];
  }
};

export const persist = (pdno: string, drawings: Drawing[]): void => {
  if (typeof window === 'undefined') return;
  try {
    if (drawings.length === 0) {
      window.localStorage.removeItem(getDrawingStorageKey(pdno));
      return;
    }
    window.localStorage.setItem(getDrawingStorageKey(pdno), JSON.stringify(drawings));
  } catch {
    // quota / privacy mode 는 치명적이지 않으므로 삼킨다.
  }
};
