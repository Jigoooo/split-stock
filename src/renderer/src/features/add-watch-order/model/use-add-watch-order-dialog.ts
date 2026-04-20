import { useState, useTransition } from 'react';
import type { WatchOrderFormPrefill } from './types';

export interface UseAddWatchOrderDialogResult {
  open: boolean;
  prefill: WatchOrderFormPrefill | null;
  /** isPending: open/close 가 transition 안에서 deferred — 클릭 응답이 즉각 반영되지 않을 때만 표시. */
  isPending: boolean;
  openCreate: () => void;
  openEdit: (prefill: WatchOrderFormPrefill) => void;
  close: () => void;
}

/**
 * 자동감시 추가/수정 다이얼로그 컨트롤러.
 *
 * - openCreate(): 빈 폼으로 신규 등록 모드.
 * - openEdit(prefill): 기존 watch order 데이터로 수정 모드 (서버에는 cancel + create 로 전송).
 * - close(): 닫기 — 폼 상태는 다이얼로그 unmount 시 초기화.
 *
 * 다이얼로그 open/close 트리거를 useTransition 으로 감싸 다른 화면 갱신을 막지 않는다.
 */
export function useAddWatchOrderDialog(): UseAddWatchOrderDialogResult {
  const [open, setOpenRaw] = useState(false);
  const [prefill, setPrefillRaw] = useState<WatchOrderFormPrefill | null>(null);
  const [isPending, startTransition] = useTransition();

  const openCreate = (): void => {
    startTransition(() => {
      setPrefillRaw(null);
      setOpenRaw(true);
    });
  };
  const openEdit = (next: WatchOrderFormPrefill): void => {
    startTransition(() => {
      setPrefillRaw(next);
      setOpenRaw(true);
    });
  };
  const close = (): void => {
    startTransition(() => {
      setOpenRaw(false);
      setPrefillRaw(null);
    });
  };

  return { close, isPending, open, openCreate, openEdit, prefill };
}
