import { useEffect } from 'react';

export type HotkeyAction = 'BUY' | 'SELL' | 'CANCEL' | 'AMEND' | 'SUBMIT';

export interface HotkeyHandlers {
  onBuy?: () => void;
  onSell?: () => void;
  onCancel?: () => void;
  onAmend?: () => void;
  onSubmit?: () => void;
}

/**
 * HTS 주문 단축키:
 * - F3 / F9 → 매수
 * - F4 / F12 → 매도
 * - F5 → 정정
 * - F8 → 취소
 * - Enter (단, INPUT/TEXTAREA/SELECT 포커스 외) → 전송
 * enabled=false 시 리스너 미등록 (PROD 기본 OFF 대응).
 */
export function useOrderHotkeys(handlers: HotkeyHandlers, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const inFormField = target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (inFormField && e.key !== 'Enter') return;
      if (e.key === 'F3' || e.key === 'F9') {
        e.preventDefault();
        handlers.onBuy?.();
      } else if (e.key === 'F4' || e.key === 'F12') {
        e.preventDefault();
        handlers.onSell?.();
      } else if (e.key === 'F5') {
        e.preventDefault();
        handlers.onAmend?.();
      } else if (e.key === 'F8') {
        e.preventDefault();
        handlers.onCancel?.();
      } else if (e.key === 'Enter' && !inFormField) {
        e.preventDefault();
        handlers.onSubmit?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, handlers]);
}
