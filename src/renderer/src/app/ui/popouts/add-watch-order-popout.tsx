import {
  AddWatchOrderDialog,
  type AddWatchOrderPrefillPayload,
  consumeAddWatchOrderPrefill,
} from '@renderer/features/add-watch-order';
import { LOADING_MESSAGES } from '@renderer/shared/lib/loading-messages';
import { type ReactElement, useEffect, useRef, useState } from 'react';

export const AddWatchOrderPopout = (): ReactElement => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<AddWatchOrderPrefillPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const isEdit = payload?.prefill?.existingId !== undefined;

  useEffect(() => {
    try {
      const parsed = consumeAddWatchOrderPrefill();
      if (parsed) setPayload(parsed);
    } catch {
      // 파싱 실패 시 빈 신규 폼으로 진행
    }
    setOpen(true);
    setReady(true);
  }, []);

  useEffect(() => {
    document.title = isEdit ? 'Split Stock · 자동감시 수정' : 'Split Stock · 자동감시 추가';
  }, [isEdit]);

  useEffect(() => {
    const shell = window.appShell;
    const node = contentRef.current;
    if (!ready || !shell?.fitContentHeight || !node) return;

    let frameId = 0;
    let lastHeight = 0;
    const schedule = (): void => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        const nextHeight = Math.ceil(node.getBoundingClientRect().height);
        if (nextHeight <= 0 || nextHeight === lastHeight) return;
        lastHeight = nextHeight;
        void shell.fitContentHeight(nextHeight);
      });
    };

    schedule();
    const observer = new ResizeObserver(() => schedule());
    observer.observe(node);
    window.addEventListener('resize', schedule);
    return () => {
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [ready]);

  const handleClose = (): void => {
    setOpen(false);
    window.close();
  };

  if (!ready) {
    return <div style={{ padding: '1rem' }}>{LOADING_MESSAGES.GENERAL}</div>;
  }

  return (
    <div ref={contentRef}>
      <AddWatchOrderDialog
        open={open}
        accountId={payload?.accountId ?? 0}
        prefill={payload?.prefill ?? null}
        layout="page"
        onClose={handleClose}
      />
    </div>
  );
};
