import { type StockListEntry, StockPickerList } from '@renderer/entities/stock';
import type { WatchOrderType, WatchQtyMode } from '@renderer/entities/watch-order';
import { Button, DateInput, NumberInput, Select } from '@renderer/shared/ui';
import type { CSSProperties, ReactElement } from 'react';
import { calcAmountPreview } from '../model/add-watch-order-form';

const ORDER_TYPE_ITEMS: ReadonlyArray<{ value: WatchOrderType; label: string }> = [
  { value: 'LIMIT', label: '지정가' },
  { value: 'MARKET', label: '시장가' },
];

const QTY_MODE_ITEMS: ReadonlyArray<{ value: WatchQtyMode; label: string }> = [
  { value: 'QTY', label: '수량' },
  { value: 'AMOUNT', label: '금액' },
];

const EXPIRY_QUICK: ReadonlyArray<{ months: number; label: string }> = [
  { months: 1, label: '1개월' },
  { months: 3, label: '3개월' },
  { months: 12, label: '1년' },
];

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

interface SectionBaseProps {
  isPageLayout: boolean;
  isDense: boolean;
  isPending: boolean;
}

interface WatchConditionsSectionProps extends SectionBaseProps {
  pdno: string;
  pdName: string;
  targetPriceRaw: string;
  expiresAtIso: string;
  todayIso: string;
  setTargetPriceRaw: (value: string) => void;
  setExpiresAtIso: (value: string) => void;
  onPickStock: (entry: StockListEntry) => void;
  onPickExpiry: (months: number) => void;
}

export const WatchConditionsSection = ({
  expiresAtIso,
  isDense,
  isPageLayout,
  isPending,
  onPickExpiry,
  onPickStock,
  pdName,
  pdno,
  setExpiresAtIso,
  setTargetPriceRaw,
  targetPriceRaw,
  todayIso,
}: WatchConditionsSectionProps): ReactElement => (
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
              ? '검색 결과에서 선택한 종목으로 예약매수가 등록됩니다.'
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
        <span>감시가격 이하 도달 시 예약매수 실행</span>
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

    <FormRow label="유효일">
      <div style={{ display: 'grid', gap: isPageLayout ? '0.5rem' : '0.3rem' }}>
        <DateInput
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
          {EXPIRY_QUICK.map((item) => (
            <Button
              key={item.months}
              onClick={() => onPickExpiry(item.months)}
              disabled={isPending}
              dense={isDense}
            >
              {item.label}
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
);

interface ExecutionConditionsSectionProps extends SectionBaseProps {
  orderType: WatchOrderType;
  qtyMode: WatchQtyMode;
  qtyRaw: string;
  amountKrwRaw: string;
  targetPriceRaw: string;
  setOrderType: (value: WatchOrderType) => void;
  setQtyMode: (value: WatchQtyMode) => void;
  setQtyRaw: (value: string) => void;
  setAmountKrwRaw: (value: string) => void;
  onAmountQuick: (delta: number) => void;
  onAmountReset: () => void;
}

export const ExecutionConditionsSection = ({
  amountKrwRaw,
  isDense,
  isPageLayout,
  isPending,
  onAmountQuick,
  onAmountReset,
  orderType,
  qtyMode,
  qtyRaw,
  setAmountKrwRaw,
  setOrderType,
  setQtyMode,
  setQtyRaw,
  targetPriceRaw,
}: ExecutionConditionsSectionProps): ReactElement => {
  const preview = calcAmountPreview(amountKrwRaw, targetPriceRaw);

  return (
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
        예약매수가 실행될 때 어떤 방식과 수량 기준으로 주문할지 정합니다.
      </div>

      <FormRow label="주문 방식">
        <Select
          dense={isDense}
          value={orderType}
          onChange={(e) => setOrderType(e.target.value as WatchOrderType)}
          aria-label="주문타입"
          disabled={isPending}
        >
          {ORDER_TYPE_ITEMS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
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
          {QTY_MODE_ITEMS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
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
              {AMOUNT_QUICK.map((item) => (
                <Button
                  key={item.delta}
                  onClick={() => onAmountQuick(item.delta)}
                  disabled={isPending}
                  dense={isDense}
                >
                  {item.label}
                </Button>
              ))}
              <Button onClick={onAmountReset} disabled={isPending} dense={isDense} variant="danger">
                초기화
              </Button>
            </div>
            {preview ? (
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
            ) : null}
          </div>
        </FormRow>
      )}
    </section>
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
