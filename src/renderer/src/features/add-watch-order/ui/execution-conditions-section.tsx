import type { WatchOrderType, WatchQtyMode } from '@renderer/entities/watch-order';
import { Button, NumberInput, Select } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import {
  AMOUNT_QUICK,
  ORDER_TYPE_ITEMS,
  QTY_MODE_ITEMS,
  sectionCardStyle,
} from '../config/add-watch-order-section-options';
import { type AddWatchOrderFormErrors, calcAmountPreview } from '../model/add-watch-order-form';
import { AddWatchOrderFormRow } from './add-watch-order-form-row';

interface ExecutionConditionsSectionProps {
  amountKrwRaw: string;
  errors: AddWatchOrderFormErrors;
  isDense: boolean;
  isPageLayout: boolean;
  isPending: boolean;
  onAmountQuick: (delta: number) => void;
  onAmountReset: () => void;
  orderType: WatchOrderType;
  qtyMode: WatchQtyMode;
  qtyRaw: string;
  setAmountKrwRaw: (value: string) => void;
  setOrderType: (value: WatchOrderType) => void;
  setQtyMode: (value: WatchQtyMode) => void;
  setQtyRaw: (value: string) => void;
  targetPriceRaw: string;
}

export const ExecutionConditionsSection = ({
  amountKrwRaw,
  errors,
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

      <AddWatchOrderFormRow label="주문 방식">
        <Select
          dense={isDense}
          value={orderType}
          onChange={(event) => setOrderType(event.target.value as WatchOrderType)}
          aria-label="주문타입"
          disabled={isPending}
        >
          {ORDER_TYPE_ITEMS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </AddWatchOrderFormRow>

      <AddWatchOrderFormRow label="설정 기준">
        <Select
          dense={isDense}
          value={qtyMode}
          onChange={(event) => setQtyMode(event.target.value as WatchQtyMode)}
          aria-label="금액/수량"
          disabled={isPending}
        >
          {QTY_MODE_ITEMS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </AddWatchOrderFormRow>

      {qtyMode === 'QTY' ? (
        <AddWatchOrderFormRow label="수량" error={errors.qtyRaw}>
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
              aria-invalid={Boolean(errors.qtyRaw)}
              dense={isDense}
              disabled={isPending}
            />
            <span className="muted">주</span>
          </div>
        </AddWatchOrderFormRow>
      ) : (
        <AddWatchOrderFormRow label="주문금액" error={errors.amountKrwRaw}>
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
                aria-invalid={Boolean(errors.amountKrwRaw)}
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
        </AddWatchOrderFormRow>
      )}
    </section>
  );
};
