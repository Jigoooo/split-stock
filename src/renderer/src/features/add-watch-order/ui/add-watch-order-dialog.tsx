import type {
  WatchComparator,
  WatchOrder,
  WatchOrderType,
  WatchQtyMode,
  WatchSide,
} from '@renderer/entities/watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, NumberInput, RadioGroup, TextInput } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';

/**
 * 폼 prefill — edit 모드에서 사용. 신규는 null.
 *
 * `existingId` 가 주어지면 다이얼로그는 "수정" 모드로 동작 — 저장 시 cancel(existingId) + create
 * 조합으로 처리한다 (서버에 update mutation 부재). 이 경우 새 row 의 id/createdAt 은 갱신된다.
 */
export interface WatchOrderFormPrefill {
  existingId?: number;
  pdno?: string;
  side?: WatchSide;
  comparator?: WatchComparator;
  targetPrice?: number;
  orderType?: WatchOrderType;
  qtyOrAmountMode?: WatchQtyMode;
  qty?: number;
  amountKrw?: number;
}

export interface AddWatchOrderDialogProps {
  open: boolean;
  accountId: number;
  prefill: WatchOrderFormPrefill | null;
  onClose: () => void;
  /** 저장 성공 시 호출 — 호출측이 watch.list invalidate. */
  onSaved?: (order: WatchOrder) => void;
}

const SIDE_ITEMS = [
  { value: 'BUY' as const, label: '매수' },
  { value: 'SELL' as const, label: '매도' },
];

const COMPARATOR_ITEMS = [
  { value: 'LTE' as const, label: '이하 (≤)' },
  { value: 'GTE' as const, label: '이상 (≥)' },
];

const ORDER_TYPE_ITEMS = [
  { value: 'LIMIT' as const, label: '지정가' },
  { value: 'MARKET' as const, label: '시장가' },
];

const QTY_MODE_ITEMS = [
  { value: 'QTY' as const, label: '수량' },
  { value: 'AMOUNT' as const, label: '금액(원)' },
];

function toIntOrNull(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * 자동감시 추가/수정 다이얼로그 (CUSTOM source 전용).
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
  const { accountId, onClose, onSaved, open, prefill } = props;
  if (!open) return null;
  return (
    <AddWatchOrderDialogInner
      key={prefill?.existingId ?? 'new'}
      accountId={accountId}
      onClose={onClose}
      onSaved={onSaved}
      prefill={prefill}
    />
  );
};

interface InnerProps {
  accountId: number;
  prefill: WatchOrderFormPrefill | null;
  onClose: () => void;
  onSaved?: ((order: WatchOrder) => void) | undefined;
}

const AddWatchOrderDialogInner = (props: InnerProps): ReactElement => {
  const { accountId, onClose, onSaved, prefill } = props;
  const utils = trpc.useUtils();
  const cancelMutation = trpc.watch.cancel.useMutation();
  const createMutation = trpc.watch.create.useMutation();
  const isEdit = prefill?.existingId !== undefined;

  const [pdno, setPdno] = useState<string>(prefill?.pdno ?? '');
  const [side, setSide] = useState<WatchSide>(prefill?.side ?? 'BUY');
  const [comparator, setComparator] = useState<WatchComparator>(prefill?.comparator ?? 'LTE');
  const [targetPriceRaw, setTargetPriceRaw] = useState<string>(
    prefill?.targetPrice !== undefined ? String(prefill.targetPrice) : '',
  );
  const [orderType, setOrderType] = useState<WatchOrderType>(prefill?.orderType ?? 'LIMIT');
  const [qtyMode, setQtyMode] = useState<WatchQtyMode>(prefill?.qtyOrAmountMode ?? 'QTY');
  const [qtyRaw, setQtyRaw] = useState<string>(
    prefill?.qty !== undefined ? String(prefill.qty) : '',
  );
  const [amountKrwRaw, setAmountKrwRaw] = useState<string>(
    prefill?.amountKrw !== undefined ? String(prefill.amountKrw) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const validate = (): {
    targetPrice: number;
    qty?: number;
    amountKrw?: number;
  } | null => {
    if (!/^\d{6}$/.test(pdno)) {
      setError('종목코드는 6자리 숫자여야 합니다.');
      return null;
    }
    const targetPrice = toIntOrNull(targetPriceRaw);
    if (targetPrice === null) {
      setError('목표가를 양의 정수로 입력하세요.');
      return null;
    }
    if (qtyMode === 'QTY') {
      const qty = toIntOrNull(qtyRaw);
      if (qty === null) {
        setError('수량을 양의 정수로 입력하세요.');
        return null;
      }
      return { qty, targetPrice };
    }
    const amountKrw = toIntOrNull(amountKrwRaw);
    if (amountKrw === null) {
      setError('금액(원)을 양의 정수로 입력하세요.');
      return null;
    }
    return { amountKrw, targetPrice };
  };

  const onSubmit = async (): Promise<void> => {
    const v = validate();
    if (v === null) return;
    setError(null);
    try {
      // 수정 모드: 기존 행 cancel → 새 행 create. 둘 사이 race window 는 사용자 1명 상정 시
      // 무시 가능. cancel 실패 시 create 도 중단해 중복 생성 방지.
      if (isEdit && prefill?.existingId !== undefined) {
        await cancelMutation.mutateAsync({ id: prefill.existingId });
      }
      const result = await createMutation.mutateAsync({
        accountId,
        pdno,
        source: 'CUSTOM',
        side,
        targetPrice: v.targetPrice,
        comparator,
        orderType,
        qtyOrAmountMode: qtyMode,
        ...(qtyMode === 'QTY' ? { qty: v.qty as number } : { amountKrw: v.amountKrw as number }),
      });
      await utils.watch.list.invalidate();
      onSaved?.(result.order as unknown as WatchOrder);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const isPending = createMutation.isPending || cancelMutation.isPending;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? '자동감시 수정' : '자동감시 추가'}
    >
      <div className="modal panel" style={{ minWidth: '320px', maxWidth: '480px' }}>
        <div className="panel__title">{isEdit ? '자동감시 수정' : '자동감시 추가'}</div>
        <div className="panel__body" style={{ display: 'grid', gap: '0.8rem' }}>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <span>종목코드 (6자리)</span>
            <TextInput
              type="text"
              value={pdno}
              onChange={(e) => setPdno(e.target.value.trim())}
              placeholder="005930"
              maxLength={6}
              aria-label="종목코드"
              dense
              disabled={isPending}
            />
          </div>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <span>방향</span>
            <RadioGroup
              name="watch-side"
              value={side}
              onChange={setSide}
              items={SIDE_ITEMS}
              ariaLabel="방향"
              dense
            />
          </div>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <span>비교</span>
            <RadioGroup
              name="watch-comparator"
              value={comparator}
              onChange={setComparator}
              items={COMPARATOR_ITEMS}
              ariaLabel="비교"
              dense
            />
          </div>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <span>목표가</span>
            <NumberInput
              value={targetPriceRaw}
              onValueChange={setTargetPriceRaw}
              placeholder="0"
              aria-label="목표가"
              dense
              disabled={isPending}
            />
          </div>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <span>주문 유형</span>
            <RadioGroup
              name="watch-order-type"
              value={orderType}
              onChange={setOrderType}
              items={ORDER_TYPE_ITEMS}
              ariaLabel="주문 유형"
              dense
            />
          </div>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <span>수량/금액 모드</span>
            <RadioGroup
              name="watch-qty-mode"
              value={qtyMode}
              onChange={setQtyMode}
              items={QTY_MODE_ITEMS}
              ariaLabel="수량/금액 모드"
              dense
            />
          </div>
          {qtyMode === 'QTY' ? (
            <div style={{ display: 'grid', gap: '0.3rem' }}>
              <span>수량</span>
              <NumberInput
                value={qtyRaw}
                onValueChange={setQtyRaw}
                placeholder="0"
                aria-label="수량"
                dense
                disabled={isPending}
              />
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.3rem' }}>
              <span>금액(원)</span>
              <NumberInput
                value={amountKrwRaw}
                onValueChange={setAmountKrwRaw}
                placeholder="0"
                aria-label="금액(원)"
                dense
                disabled={isPending}
              />
            </div>
          )}
          {isEdit ? (
            <div className="muted" style={{ fontSize: '0.9rem' }}>
              ※ 수정은 기존 항목 취소 후 새 항목으로 등록됩니다 (id/등록시각 갱신).
            </div>
          ) : null}
          {error ? (
            <div className="chip chip--down" role="alert">
              {error}
            </div>
          ) : null}
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}
        >
          <Button onClick={onClose} disabled={isPending} dense>
            취소
          </Button>
          <Button
            onClick={() => {
              void onSubmit();
            }}
            disabled={isPending}
            variant="primary"
            dense
          >
            {isPending ? '저장 중…' : isEdit ? '수정' : '추가'}
          </Button>
        </div>
      </div>
    </div>
  );
};
