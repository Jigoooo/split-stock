import { useEffect, useEffectEvent } from 'react';

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
  const handleHotkey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const inFormField = target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    if (inFormField && event.key !== 'Enter') return;
    if (event.key === 'F3' || event.key === 'F9') {
      event.preventDefault();
      handlers.onBuy?.();
    } else if (event.key === 'F4' || event.key === 'F12') {
      event.preventDefault();
      handlers.onSell?.();
    } else if (event.key === 'F5') {
      event.preventDefault();
      handlers.onAmend?.();
    } else if (event.key === 'F8') {
      event.preventDefault();
      handlers.onCancel?.();
    } else if (event.key === 'Enter' && !inFormField) {
      event.preventDefault();
      handlers.onSubmit?.();
    }
  });

  useEffect(() => {
    if (!enabled) return;

    const onKey = (event: KeyboardEvent): void => {
      handleHotkey(event);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
