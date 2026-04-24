import type { StockListEntry } from '@renderer/entities/stock';
import type { WatchOrder, WatchOrderType, WatchQtyMode } from '@renderer/entities/watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useState } from 'react';
import {
  addMonthsIso,
  todayIsoLocal,
  toIsoDateLocal,
  validateAddWatchOrderForm,
} from '../model/add-watch-order-form';
import type { WatchOrderFormPrefill } from '../model/types';
import {
  ExecutionConditionsSection,
  WatchConditionsSection,
} from './add-watch-order-dialog-sections';

export interface AddWatchOrderDialogProps {
  open: boolean;
  accountId: number;
  prefill: WatchOrderFormPrefill | null;
  onClose: () => void;
  /** 팝아웃 창에서는 page 모드로 전체 영역을 사용한다. */
  layout?: 'modal' | 'page';
  /** 저장 성공 시 호출 — 호출측이 watch.list invalidate. */
  onSaved?: (order: WatchOrder) => void;
}

/**
 * 자동감시 추가/수정 다이얼로그 (예약매수 전용).
 *
 * 보안 가드:
 *   - accountId 는 호출측이 useActiveAccountId 로 주입한 값만 받는다 — 서버는
 *     `input.accountId === activeAccountId` 강제 검증 (watch-router).
 *
 * 수정 모드 처리:
 *   - server 에 watch.update 미구현 → cancel(existingId) + create(new) 조합.
 *   - 새 row 의 id/createdAt 갱신, status 는 'WATCHING' 으로 리셋.
 *
 * 다이얼로그는 `open=false` 일 때 unmount → 다시 mount 시 prefill 로 초기화.
 */
export const AddWatchOrderDialog = (props: AddWatchOrderDialogProps): ReactElement | null => {
  const { accountId, layout = 'modal', onClose, onSaved, open, prefill } = props;
  if (!open) return null;
  return (
    <AddWatchOrderDialogInner
      key={prefill?.existingId ?? 'new'}
      accountId={accountId}
      layout={layout}
      onClose={onClose}
      onSaved={onSaved}
      prefill={prefill}
    />
  );
};

interface InnerProps {
  accountId: number;
  layout: 'modal' | 'page';
  prefill: WatchOrderFormPrefill | null;
  onClose: () => void;
  onSaved?: ((order: WatchOrder) => void) | undefined;
}

const AddWatchOrderDialogInner = (props: InnerProps): ReactElement => {
  const { accountId, layout, onClose, onSaved, prefill } = props;
  const utils = trpc.useUtils();
  const createMutation = trpc.watch.create.useMutation();
  const updateMutation = trpc.watch.update.useMutation();
  const isEdit = prefill?.existingId !== undefined;

  const [pdno, setPdno] = useState<string>(prefill?.pdno ?? '');
  const [pdName, setPdName] = useState<string>(prefill?.pdName ?? '');
  const [targetPriceRaw, setTargetPriceRaw] = useState<string>(
    prefill?.targetPrice !== undefined ? String(prefill.targetPrice) : '',
  );
  const [orderType, setOrderType] = useState<WatchOrderType>(prefill?.orderType ?? 'MARKET');
  const [qtyMode, setQtyMode] = useState<WatchQtyMode>(prefill?.qtyOrAmountMode ?? 'AMOUNT');
  const [qtyRaw, setQtyRaw] = useState<string>(
    prefill?.qty !== undefined ? String(prefill.qty) : '',
  );
  const [amountKrwRaw, setAmountKrwRaw] = useState<string>(
    prefill?.amountKrw !== undefined ? String(prefill.amountKrw) : '',
  );
  const [expiresAtIso, setExpiresAtIso] = useState<string>(
    prefill?.expiresAtMs !== undefined ? toIsoDateLocal(new Date(prefill.expiresAtMs)) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const todayIso = todayIsoLocal();

  const onPickStock = (entry: StockListEntry): void => {
    setPdno(entry.pdno);
    setPdName(entry.name);
    setError(null);
  };

  const onPickExpiry = (months: number): void => {
    setExpiresAtIso(addMonthsIso(months));
  };

  const onAmountQuick = (delta: number): void => {
    const parsed = Number(amountKrwRaw);
    const cur = Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    setAmountKrwRaw(String(cur + delta));
  };

  const onAmountReset = (): void => {
    setAmountKrwRaw('');
  };

  const onSubmit = async (): Promise<void> => {
    const validation = validateAddWatchOrderForm({
      pdno,
      targetPriceRaw,
      qtyMode,
      qtyRaw,
      amountKrwRaw,
      expiresAtIso,
    });
    if ('error' in validation) {
      setError(validation.error);
      return;
    }

    const v = validation.value;
    setError(null);
    try {
      const payload = {
        accountId,
        pdno,
        targetPrice: v.targetPrice,
        orderType,
        qtyOrAmountMode: qtyMode,
        ...(qtyMode === 'QTY' ? { qty: v.qty as number } : { amountKrw: v.amountKrw as number }),
        ...(v.expiresAt !== undefined ? { expiresAt: v.expiresAt } : {}),
      };
      const result =
        isEdit && prefill?.existingId !== undefined
          ? await updateMutation.mutateAsync({ id: prefill.existingId, ...payload })
          : await createMutation.mutateAsync(payload);
      await utils.watch.list.invalidate();
      await utils.watch.getControlState.invalidate();
      await utils.watch.history.invalidate();
      onSaved?.(result.order as unknown as WatchOrder);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isPageLayout = layout === 'page';
  const isDense = !isPageLayout;
  const titleText = isEdit ? '자동감시 수정' : '자동감시 추가';
  const chromePadding = isPageLayout ? '0.9rem 1.1rem' : '0.35rem 0.6rem';
  const bodyPadding = isPageLayout ? '1rem 1.1rem' : '0.4rem 0.6rem';
  const bodyGap = isPageLayout ? '1rem 1.5rem' : '0.5rem 0.8rem';

  const content = (
    <div
      className={`panel${layout === 'page' ? ' add-watch-order-page' : ' modal'}`}
      style={
        isPageLayout
          ? {
              width: '100%',
              borderRadius: 0,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
            }
          : { minWidth: '600px', maxWidth: '720px', width: '600px' }
      }
    >
      {isPageLayout ? null : (
        <div className="panel__title" style={{ padding: chromePadding, fontSize: '1rem' }}>
          {titleText}
        </div>
      )}

      <div
        className="panel__body"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: bodyGap,
          alignItems: 'start',
          flex: 1,
          minHeight: 0,
          padding: bodyPadding,
        }}
      >
        <WatchConditionsSection
          pdno={pdno}
          pdName={pdName}
          targetPriceRaw={targetPriceRaw}
          expiresAtIso={expiresAtIso}
          todayIso={todayIso}
          isPageLayout={isPageLayout}
          isDense={isDense}
          isPending={isPending}
          setTargetPriceRaw={setTargetPriceRaw}
          setExpiresAtIso={setExpiresAtIso}
          onPickStock={onPickStock}
          onPickExpiry={onPickExpiry}
        />
        <ExecutionConditionsSection
          orderType={orderType}
          qtyMode={qtyMode}
          qtyRaw={qtyRaw}
          amountKrwRaw={amountKrwRaw}
          targetPriceRaw={targetPriceRaw}
          isPageLayout={isPageLayout}
          isDense={isDense}
          isPending={isPending}
          setOrderType={setOrderType}
          setQtyMode={setQtyMode}
          setQtyRaw={setQtyRaw}
          setAmountKrwRaw={setAmountKrwRaw}
          onAmountQuick={onAmountQuick}
          onAmountReset={onAmountReset}
        />
      </div>

      {/* 메시지/알림 */}
      {(isEdit || error) && (
        <div
          className="panel__body"
          style={{
            display: 'grid',
            gap: isPageLayout ? '0.45rem' : '0.3rem',
            padding: chromePadding,
          }}
        >
          {isEdit ? (
            <div className="muted" style={{ fontSize: isPageLayout ? '0.9rem' : '0.8rem' }}>
              ※ 수정 시 예약매수 조건만 갱신되며, 감시 이력은 유지됩니다.
            </div>
          ) : null}
          {error ? (
            <div className="chip chip--down" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      )}

      {/* 액션 */}
      <div
        className="panel__body"
        style={{
          display: 'flex',
          gap: isPageLayout ? '0.6rem' : '0.5rem',
          justifyContent: 'flex-end',
          padding: chromePadding,
        }}
      >
        <Button onClick={onClose} disabled={isPending} dense={isDense}>
          취소
        </Button>
        <Button
          onClick={() => {
            void onSubmit();
          }}
          disabled={isPending}
          variant="primary"
          dense={isDense}
        >
          {isPending ? '저장 중…' : isEdit ? '수정' : '추가'}
        </Button>
      </div>
    </div>
  );

  if (layout === 'page') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? '자동감시 수정' : '자동감시 추가'}
        style={{ width: '100%', overflow: 'auto' }}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? '자동감시 수정' : '자동감시 추가'}
    >
      {content}
    </div>
  );
};
