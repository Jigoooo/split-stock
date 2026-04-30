import type { WatchOrderType, WatchQtyMode } from '@renderer/entities/watch-order';
import { Button, NumberInput, Select } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import {
  AMOUNT_QUICK,
  ORDER_TYPE_ITEMS,
  QTY_MODE_ITEMS,
  sectionCardStyle,
  sectionHeaderStyle,
  sectionTitleStyle,
  stripStyle,
} from '../config/add-watch-order-section-options';
import { type AddWatchOrderFormErrors, calcAmountPreview } from '../model/add-watch-order-form';
import { AddWatchOrderFormRow } from './add-watch-order-form-row';

interface ExecutionConditionsSectionProps {
  amountKrwRaw: string;
  currentPrice: number | null;
  errors: AddWatchOrderFormErrors;
  isDense: boolean;
  isPageLayout: boolean;
  isPending: boolean;
  onAmountQuick: (delta: number) => void;
  onAmountReset: () => void;
  orderType: WatchOrderType;
  pdName: string;
  pdno: string;
  qtyMode: WatchQtyMode;
  qtyRaw: string;
  setAmountKrwRaw: (value: string) => void;
  setOrderType: (value: WatchOrderType) => void;
  setQtyMode: (value: WatchQtyMode) => void;
  setQtyRaw: (value: string) => void;
  targetPriceDistancePct: number | null;
  targetPriceRaw: string;
}

export const ExecutionConditionsSection = ({
  amountKrwRaw,
  currentPrice,
  errors,
  isDense,
  isPageLayout,
  isPending,
  onAmountQuick,
  onAmountReset,
  orderType,
  pdName,
  pdno,
  qtyMode,
  qtyRaw,
  setAmountKrwRaw,
  setOrderType,
  setQtyMode,
  setQtyRaw,
  targetPriceDistancePct,
  targetPriceRaw,
}: ExecutionConditionsSectionProps): ReactElement => {
  const preview = calcAmountPreview(amountKrwRaw, targetPriceRaw);

  return (
    <section aria-label="실행조건" style={sectionCardStyle(isPageLayout)}>
      <div style={sectionHeaderStyle(isPageLayout)}>
        <span style={sectionTitleStyle(isPageLayout)}>실행조건</span>
        <span className="muted" style={{ fontSize: isPageLayout ? '0.84rem' : '0.76rem' }}>
          {orderType === 'LIMIT' ? '지정가' : '시장가'} · {qtyMode === 'AMOUNT' ? '금액' : '수량'}
        </span>
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
                  borderRadius: '0.45rem',
                  border: '0.1rem solid var(--border)',
                  background: preview.isHighRemainder
                    ? 'var(--color-danger-bg, rgba(255,80,80,0.12))'
                    : 'var(--bg-2)',
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

      <ExecutionSummary
        amountKrwRaw={amountKrwRaw}
        currentPrice={currentPrice}
        isPageLayout={isPageLayout}
        orderType={orderType}
        pdName={pdName}
        pdno={pdno}
        preview={preview}
        qtyMode={qtyMode}
        qtyRaw={qtyRaw}
        targetPriceDistancePct={targetPriceDistancePct}
        targetPriceRaw={targetPriceRaw}
      />
    </section>
  );
};

function ExecutionSummary({
  amountKrwRaw,
  currentPrice,
  isPageLayout,
  orderType,
  pdName,
  pdno,
  preview,
  qtyMode,
  qtyRaw,
  targetPriceDistancePct,
  targetPriceRaw,
}: {
  amountKrwRaw: string;
  currentPrice: number | null;
  isPageLayout: boolean;
  orderType: WatchOrderType;
  pdName: string;
  pdno: string;
  preview: ReturnType<typeof calcAmountPreview>;
  qtyMode: WatchQtyMode;
  qtyRaw: string;
  targetPriceDistancePct: number | null;
  targetPriceRaw: string;
}): ReactElement {
  const targetPrice = parseNumber(targetPriceRaw);
  const amountKrw = parseNumber(amountKrwRaw);
  const qty = parseNumber(qtyRaw);
  const orderLabel = orderType === 'LIMIT' ? '지정가' : '시장가';
  const basis =
    qtyMode === 'AMOUNT'
      ? amountKrw !== null
        ? `${formatKrw(amountKrw)}원`
        : '금액 미입력'
      : qty !== null
        ? `${formatKrw(qty)}주`
        : '수량 미입력';
  const distance =
    targetPriceDistancePct !== null
      ? `현재가 대비 ${formatSignedPct(targetPriceDistancePct)}`
      : null;

  return (
    <section
      aria-label="저장 요약"
      style={{
        ...stripStyle(isPageLayout),
        fontSize: isPageLayout ? '0.9rem' : '0.8rem',
      }}
    >
      <strong style={{ color: 'var(--fg-2)' }}>저장 요약</strong>
      <span>
        {pdno ? `${pdName || pdno} ` : '종목 선택 후 '}
        {targetPrice !== null ? `${formatKrw(targetPrice)}원 이하` : '감시가격 미입력'}
        {distance ? ` (${distance})` : ''} 도달 시 {orderLabel} 예약매수
      </span>
      <span className="muted">
        기준 {basis}
        {preview
          ? `, 예상 ${formatKrw(preview.qty)}주 / 잔여 ${formatKrw(preview.remainder)}원`
          : ''}
        {currentPrice !== null ? `, 현재가 ${formatKrw(currentPrice)}원` : ''}
      </span>
    </section>
  );
}

function parseNumber(value: string): number | null {
  const parsed = Number(value.replaceAll(',', '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatKrw(value: number): string {
  return value.toLocaleString('ko-KR');
}

function formatSignedPct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}
