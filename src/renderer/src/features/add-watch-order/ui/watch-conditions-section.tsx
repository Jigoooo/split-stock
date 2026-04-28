import { type StockListEntry, StockPickerList } from '@renderer/entities/stock';
import { Button, DateInput, NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { EXPIRY_QUICK, sectionCardStyle } from '../config/add-watch-order-section-options';
import type { AddWatchOrderFormErrors } from '../model/add-watch-order-form';
import { AddWatchOrderFormRow } from './add-watch-order-form-row';

interface WatchConditionsSectionProps {
  errors: AddWatchOrderFormErrors;
  expiresAtIso: string;
  isDense: boolean;
  isPageLayout: boolean;
  isPending: boolean;
  onPickExpiry: (months: number) => void;
  onPickStock: (entry: StockListEntry) => void;
  pdName: string;
  pdno: string;
  setExpiresAtIso: (value: string) => void;
  setTargetPriceRaw: (value: string) => void;
  targetPriceRaw: string;
  todayIso: string;
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
  errors,
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

    <AddWatchOrderFormRow label="종목" error={errors.pdno}>
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
          <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap' }}>
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
    </AddWatchOrderFormRow>

    <AddWatchOrderFormRow label="감시방식">
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
    </AddWatchOrderFormRow>

    <AddWatchOrderFormRow label="감시가격" error={errors.targetPriceRaw}>
      <div
        style={{ display: 'flex', gap: isPageLayout ? '0.55rem' : '0.4rem', alignItems: 'center' }}
      >
        <NumberInput
          value={targetPriceRaw}
          onValueChange={setTargetPriceRaw}
          placeholder="0"
          aria-label="감시가격"
          aria-invalid={Boolean(errors.targetPriceRaw)}
          dense={isDense}
          disabled={isPending}
        />
        <span className="muted">원</span>
      </div>
    </AddWatchOrderFormRow>

    <AddWatchOrderFormRow label="유효일" error={errors.expiresAtIso}>
      <div style={{ display: 'grid', gap: isPageLayout ? '0.5rem' : '0.3rem' }}>
        <DateInput
          value={expiresAtIso}
          onChange={(event) => setExpiresAtIso(event.target.value)}
          min={todayIso}
          aria-label="유효일"
          aria-invalid={Boolean(errors.expiresAtIso)}
          dense={isDense}
          disabled={isPending}
        />
        <div
          style={{ display: 'flex', gap: isPageLayout ? '0.45rem' : '0.3rem', flexWrap: 'wrap' }}
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
    </AddWatchOrderFormRow>
  </section>
);
