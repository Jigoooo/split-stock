import type {
  WatchComparator,
  WatchOrder,
  WatchOrderType,
  WatchQtyMode,
  WatchSide,
} from '@renderer/entities/watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, NumberInput, RadioGroup, Select, TextInput } from '@renderer/shared/ui';
import { type StockListEntry, StockPickerList } from '@renderer/widgets/stock-picker-list';
import type { CSSProperties, ReactElement } from 'react';
import { useState } from 'react';

/**
 * 폼 prefill — edit 모드에서 사용. 신규는 null.
 *
 * `existingId` 가 주어지면 다이얼로그는 "수정" 모드로 동작 — 저장 시 cancel(existingId) + create
 * 조합으로 처리한다 (서버에 update mutation 부재). 이 경우 새 row 의 id/createdAt 은 갱신된다.
 */
export interface WatchOrderFormPrefill {
  existingId?: number;
  pdno?: string;
  pdName?: string;
  side?: WatchSide;
  comparator?: WatchComparator;
  targetPrice?: number;
  orderType?: WatchOrderType;
  qtyOrAmountMode?: WatchQtyMode;
  qty?: number;
  amountKrw?: number;
  /** ms epoch — 만료일. */
  expiresAtMs?: number;
}

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

const SIDE_ITEMS: ReadonlyArray<{ value: WatchSide; label: string }> = [
  { value: 'BUY', label: '매수' },
  { value: 'SELL', label: '매도' },
];

const COMPARATOR_ITEMS: ReadonlyArray<{
  value: WatchComparator;
  label: string;
  description: string;
}> = [
  {
    value: 'LTE',
    label: '목표가 이하',
    description: '현재가가 설정한 가격 이하로 내려가면 자동감시가 트리거됩니다.',
  },
  {
    value: 'GTE',
    label: '목표가 이상',
    description: '현재가가 설정한 가격 이상으로 올라가면 자동감시가 트리거됩니다.',
  },
];

/** side 변경 시 자연스러운 comparator 기본값. */
function defaultComparatorForSide(s: WatchSide): WatchComparator {
  return s === 'BUY' ? 'LTE' : 'GTE';
}

const ORDER_TYPE_ITEMS: ReadonlyArray<{ value: WatchOrderType; label: string }> = [
  { value: 'LIMIT', label: '지정가' },
  { value: 'MARKET', label: '시장가' },
];

const QTY_MODE_ITEMS: ReadonlyArray<{ value: WatchQtyMode; label: string }> = [
  { value: 'QTY', label: '수량' },
  { value: 'AMOUNT', label: '금액' },
];

/** 빠른선택 — 유효일 (개월 수). */
const EXPIRY_QUICK: ReadonlyArray<{ months: number; label: string }> = [
  { months: 1, label: '1개월' },
  { months: 3, label: '3개월' },
  { months: 12, label: '1년' },
];

/** 빠른입력 — 주문금액 (원). */
const AMOUNT_QUICK: ReadonlyArray<{ delta: number; label: string }> = [
  { delta: 100_000, label: '+10만' },
  { delta: 500_000, label: '+50만' },
  { delta: 1_000_000, label: '+100만' },
  { delta: 5_000_000, label: '+500만' },
  { delta: 10_000_000, label: '+1000만' },
];

const sectionCardStyle = (isPageLayout: boolean): CSSProperties => ({
  display: 'grid',
  gap: isPageLayout ? '0.85rem' : '0.4rem',
  alignContent: 'start',
  padding: isPageLayout ? '1rem 1.1rem' : '0.7rem 0.8rem',
  border: '0.1rem solid var(--border)',
  borderRadius: isPageLayout ? '0.8rem' : '0.6rem',
  background: isPageLayout
    ? 'linear-gradient(180deg, var(--bg) 0%, var(--bg-3) 100%)'
    : 'var(--bg)',
  boxShadow: isPageLayout ? '0 0.6rem 1.6rem rgba(15, 23, 42, 0.05)' : 'none',
});

function toIntOrNull(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * 금액 → 주식 수 환산 미리보기.
 * qty = floor(amountKrw / targetPrice), 잔여 = amountKrw - qty * targetPrice
 * targetPrice 또는 amountKrw 미입력 시 null 반환.
 */
function calcAmountPreview(
  amountKrwRaw: string,
  targetPriceRaw: string,
): { qty: number; filled: number; remainder: number; isHighRemainder: boolean } | null {
  const amount = toIntOrNull(amountKrwRaw);
  const price = toIntOrNull(targetPriceRaw);
  if (amount === null || price === null) return null;
  const qty = Math.floor(amount / price);
  if (qty <= 0) return null;
  const filled = qty * price;
  const remainder = amount - filled;
  return { qty, filled, remainder, isHighRemainder: remainder >= amount * 0.5 };
}

function toIsoDateLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function todayIsoLocal(): string {
  return toIsoDateLocal(new Date());
}

function addMonthsIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return toIsoDateLocal(d);
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
  const cancelMutation = trpc.watch.cancel.useMutation();
  const createMutation = trpc.watch.create.useMutation();
  const isEdit = prefill?.existingId !== undefined;

  const [pdno, setPdno] = useState<string>(prefill?.pdno ?? '');
  const [pdName, setPdName] = useState<string>(prefill?.pdName ?? '');
  const [side, setSide] = useState<WatchSide>(prefill?.side ?? 'BUY');
  const [comparator, setComparator] = useState<WatchComparator>(
    prefill?.comparator ?? defaultComparatorForSide(prefill?.side ?? 'BUY'),
  );
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
    const cur = toIntOrNull(amountKrwRaw) ?? 0;
    setAmountKrwRaw(String(cur + delta));
  };

  const onAmountReset = (): void => {
    setAmountKrwRaw('');
  };

  const validate = (): {
    targetPrice: number;
    qty?: number;
    amountKrw?: number;
    expiresAt?: number;
  } | null => {
    if (!/^\d{6}$/.test(pdno)) {
      setError('종목을 검색해서 선택해주세요.');
      return null;
    }
    const targetPrice = toIntOrNull(targetPriceRaw);
    if (targetPrice === null) {
      setError('감시가격(목표가)을 양의 정수로 입력하세요.');
      return null;
    }
    let qty: number | undefined;
    let amountKrw: number | undefined;
    if (qtyMode === 'QTY') {
      const v = toIntOrNull(qtyRaw);
      if (v === null) {
        setError('수량을 양의 정수로 입력하세요.');
        return null;
      }
      qty = v;
    } else {
      const v = toIntOrNull(amountKrwRaw);
      if (v === null) {
        setError('주문금액을 양의 정수로 입력하세요.');
        return null;
      }
      amountKrw = v;
    }
    let expiresAt: number | undefined;
    if (expiresAtIso.trim() !== '') {
      const ts = Date.parse(`${expiresAtIso}T23:59:59`);
      if (!Number.isFinite(ts) || ts <= Date.now()) {
        setError('유효일은 오늘 이후 날짜를 선택하세요.');
        return null;
      }
      expiresAt = ts;
    }
    const result: {
      targetPrice: number;
      qty?: number;
      amountKrw?: number;
      expiresAt?: number;
    } = { targetPrice };
    if (qty !== undefined) result.qty = qty;
    if (amountKrw !== undefined) result.amountKrw = amountKrw;
    if (expiresAt !== undefined) result.expiresAt = expiresAt;
    return result;
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
        ...(v.expiresAt !== undefined ? { expiresAt: v.expiresAt } : {}),
      });
      await utils.watch.list.invalidate();
      onSaved?.(result.order as unknown as WatchOrder);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const isPending = createMutation.isPending || cancelMutation.isPending;
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

      {/* 좌(감시조건) / 우(실행조건) 2 컬럼 */}
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
        {/* 감시조건 */}
        <section aria-label="감시조건" style={sectionCardStyle(isPageLayout)}>
          <div
            style={{
              fontSize: isPageLayout ? '1.05rem' : '0.9rem',
              fontWeight: 600,
              color: 'var(--fg-2)',
            }}
          >
            감시조건
          </div>
          <div className="muted" style={{ fontSize: isPageLayout ? '0.92rem' : '0.82rem' }}>
            어떤 종목을 언제 감시해서 주문으로 연결할지 정합니다.
          </div>

          <FormRow label="종목">
            <div style={{ display: 'grid', gap: isPageLayout ? '0.6rem' : '0.4rem' }}>
              <StockPickerList
                onSelect={onPickStock}
                placeholder="종목명 또는 코드 검색"
                hideSyncButton
                hidePopoutButton
                dense={isDense}
                {...(pdno ? { selectedPdno: pdno } : {})}
              />
              <div
                style={{
                  display: 'grid',
                  gap: '0.25rem',
                  padding: isPageLayout ? '0.7rem 0.85rem' : '0.45rem 0.55rem',
                  borderRadius: '0.55rem',
                  border: '0.1rem solid var(--border)',
                  background: pdno ? 'var(--accent-tint-6)' : 'var(--bg)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '0.55rem',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong style={{ fontSize: isPageLayout ? '1rem' : '0.92rem' }}>
                    {pdName || '종목을 선택하세요'}
                  </strong>
                  {pdno ? <span className="num muted">{pdno}</span> : null}
                </div>
                <div className="muted" style={{ fontSize: isPageLayout ? '0.9rem' : '0.82rem' }}>
                  {pdno
                    ? '검색 결과에서 선택한 종목으로 자동감시가 등록됩니다.'
                    : '검색창에 종목명이나 6자리 종목코드를 입력한 뒤 결과에서 선택하세요.'}
                </div>
              </div>
            </div>
          </FormRow>

          <FormRow label="감시방식">
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: isPageLayout ? '0.55rem 0.7rem' : '0.35rem 0.5rem',
                borderRadius: '999px',
                border: '0.1rem solid var(--border)',
                background: 'var(--bg)',
                fontSize: isPageLayout ? '0.94rem' : '0.86rem',
                color: 'var(--fg-2)',
              }}
            >
              <span className="chip chip--up">가격</span>
              <span>설정한 가격 도달 시 주문 실행</span>
            </div>
          </FormRow>

          <FormRow label="감시가격">
            <div
              style={{
                display: 'flex',
                gap: isPageLayout ? '0.55rem' : '0.4rem',
                alignItems: 'center',
              }}
            >
              <NumberInput
                value={targetPriceRaw}
                onValueChange={setTargetPriceRaw}
                placeholder="0"
                aria-label="감시가격"
                dense={isDense}
                disabled={isPending}
              />
              <span className="muted">원</span>
            </div>
          </FormRow>

          <FormRow label="비교">
            <div style={{ display: 'grid', gap: isPageLayout ? '0.45rem' : '0.2rem' }}>
              <RadioGroup
                name="watch-comparator"
                value={comparator}
                onChange={setComparator}
                items={COMPARATOR_ITEMS.map((it) => ({
                  value: it.value,
                  label: it.label,
                  description: it.description,
                }))}
                ariaLabel="비교"
                dense={isDense}
              />
            </div>
          </FormRow>

          <FormRow label="유효일">
            <div style={{ display: 'grid', gap: isPageLayout ? '0.5rem' : '0.3rem' }}>
              <TextInput
                type="date"
                value={expiresAtIso}
                onChange={(e) => setExpiresAtIso(e.target.value)}
                min={todayIso}
                aria-label="유효일"
                dense={isDense}
                disabled={isPending}
              />
              <div
                style={{
                  display: 'flex',
                  gap: isPageLayout ? '0.45rem' : '0.3rem',
                  flexWrap: 'wrap',
                }}
              >
                {EXPIRY_QUICK.map((q) => (
                  <Button
                    key={q.months}
                    onClick={() => onPickExpiry(q.months)}
                    disabled={isPending}
                    dense={isDense}
                  >
                    {q.label}
                  </Button>
                ))}
                {expiresAtIso ? (
                  <Button
                    onClick={() => setExpiresAtIso('')}
                    disabled={isPending}
                    dense={isDense}
                    variant="danger"
                  >
                    만료없음
                  </Button>
                ) : null}
              </div>
            </div>
          </FormRow>
        </section>

        {/* 실행조건 */}
        <section aria-label="실행조건" style={sectionCardStyle(isPageLayout)}>
          <div
            style={{
              fontSize: isPageLayout ? '1.05rem' : '0.9rem',
              fontWeight: 600,
              color: 'var(--fg-2)',
            }}
          >
            실행조건
          </div>
          <div className="muted" style={{ fontSize: isPageLayout ? '0.92rem' : '0.82rem' }}>
            트리거가 발생했을 때 어떤 방식으로 주문할지 정합니다.
          </div>

          <FormRow label="매매 방향">
            <Select
              dense={isDense}
              value={side}
              onChange={(e) => {
                const next = e.target.value as WatchSide;
                setSide(next);
                setComparator(defaultComparatorForSide(next));
              }}
              aria-label="주문구분"
              disabled={isPending}
            >
              {SIDE_ITEMS.map((it) => (
                <option key={it.value} value={it.value}>
                  {it.label}
                </option>
              ))}
            </Select>
          </FormRow>

          <FormRow label="주문 방식">
            <Select
              dense={isDense}
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as WatchOrderType)}
              aria-label="주문타입"
              disabled={isPending}
            >
              {ORDER_TYPE_ITEMS.map((it) => (
                <option key={it.value} value={it.value}>
                  {it.label}
                </option>
              ))}
            </Select>
          </FormRow>

          <FormRow label="설정 기준">
            <Select
              dense={isDense}
              value={qtyMode}
              onChange={(e) => setQtyMode(e.target.value as WatchQtyMode)}
              aria-label="금액/수량"
              disabled={isPending}
            >
              {QTY_MODE_ITEMS.map((it) => (
                <option key={it.value} value={it.value}>
                  {it.label}
                </option>
              ))}
            </Select>
          </FormRow>

          {qtyMode === 'QTY' ? (
            <FormRow label="수량">
              <div
                style={{
                  display: 'flex',
                  gap: isPageLayout ? '0.55rem' : '0.4rem',
                  alignItems: 'center',
                }}
              >
                <NumberInput
                  value={qtyRaw}
                  onValueChange={setQtyRaw}
                  placeholder="0"
                  aria-label="수량"
                  dense={isDense}
                  disabled={isPending}
                />
                <span className="muted">주</span>
              </div>
            </FormRow>
          ) : (
            <FormRow label="주문금액">
              <div style={{ display: 'grid', gap: isPageLayout ? '0.55rem' : '0.3rem' }}>
                <div
                  style={{
                    display: 'flex',
                    gap: isPageLayout ? '0.55rem' : '0.4rem',
                    alignItems: 'center',
                  }}
                >
                  <NumberInput
                    value={amountKrwRaw}
                    onValueChange={setAmountKrwRaw}
                    placeholder="0"
                    aria-label="주문금액"
                    dense={isDense}
                    disabled={isPending}
                  />
                  <span className="muted">원</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: isPageLayout ? '0.45rem' : '0.3rem',
                    flexWrap: 'wrap',
                  }}
                >
                  {AMOUNT_QUICK.map((q) => (
                    <Button
                      key={q.delta}
                      onClick={() => onAmountQuick(q.delta)}
                      disabled={isPending}
                      dense={isDense}
                    >
                      {q.label}
                    </Button>
                  ))}
                  <Button
                    onClick={onAmountReset}
                    disabled={isPending}
                    dense={isDense}
                    variant="danger"
                  >
                    초기화
                  </Button>
                </div>
                {/* 환산 미리보기 */}
                {(() => {
                  const preview = calcAmountPreview(amountKrwRaw, targetPriceRaw);
                  if (preview === null) return null;
                  return (
                    <div
                      style={{
                        fontSize: isPageLayout ? '0.9rem' : '0.8rem',
                        padding: isPageLayout ? '0.45rem 0.6rem' : '0.25rem 0.4rem',
                        borderRadius: '4px',
                        background: preview.isHighRemainder
                          ? 'var(--color-danger-bg, rgba(255,80,80,0.12))'
                          : 'var(--color-muted-bg, rgba(255,255,255,0.06))',
                        display: 'grid',
                        gap: isPageLayout ? '0.2rem' : '0.1rem',
                      }}
                    >
                      <span>
                        환산: <strong>{preview.qty.toLocaleString()}주</strong> 매수
                        {' ('}체결 {preview.filled.toLocaleString()}원{', '}잔여{' '}
                        {preview.remainder.toLocaleString()}원{')'}
                      </span>
                      {preview.isHighRemainder ? (
                        <span style={{ color: 'var(--color-danger, #f05050)' }}>
                          잔여금액이 50% 이상 — 감시가격을 조정하거나 금액을 변경하세요.
                        </span>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            </FormRow>
          )}
        </section>
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
              ※ 수정은 기존 항목 취소 후 새 항목으로 등록됩니다 (id/등록시각 갱신).
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

interface FormRowProps {
  label: string;
  children: ReactElement | ReactElement[];
}

const FormRow = ({ label, children }: FormRowProps): ReactElement => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '6rem minmax(0, 1fr)',
      gap: '0.7rem',
      alignItems: 'start',
    }}
  >
    <span className="muted" style={{ paddingTop: '0.35rem' }}>
      {label}
    </span>
    <div>{children}</div>
  </div>
);
