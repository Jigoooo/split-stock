import { type StockListEntry, StockPickerList } from '@renderer/entities/stock';
import { Button, DateInput, NumberInput } from '@renderer/shared/ui';
import { Check } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import {
  candidateGridStyle,
  EXPIRY_QUICK,
  metricRailStyle,
  panelLabelStyle,
  priceValueStyle,
  sectionCardStyle,
  sectionHeaderStyle,
  sectionTitleStyle,
  stripStyle,
} from '../config/add-watch-order-section-options';
import type { AddWatchOrderFormErrors } from '../model/add-watch-order-form';
import type {
  ReservationBuyDraft,
  ReservationBuyPriceCandidate,
} from '../model/use-add-watch-order-form-controller';
import { AddWatchOrderFormRow } from './add-watch-order-form-row';

interface WatchConditionsSectionProps {
  draft: ReservationBuyDraft | null;
  draftError: string | null;
  errors: AddWatchOrderFormErrors;
  expiresAtIso: string;
  isDraftLoading: boolean;
  isDense: boolean;
  isPageLayout: boolean;
  isPending: boolean;
  onApplyPriceCandidate: (id: ReservationBuyPriceCandidate['id']) => void;
  onPickExpiry: (months: number) => void;
  onPickStock: (entry: StockListEntry) => void;
  pdName: string;
  pdno: string;
  selectedPriceCandidateId: ReservationBuyPriceCandidate['id'] | null;
  setExpiresAtIso: (value: string) => void;
  setTargetPriceRaw: (value: string) => void;
  targetPriceRaw: string;
  targetPriceDistancePct: number | null;
  targetPriceImmediateWarning: string | null;
  todayIso: string;
}

export const WatchConditionsSection = ({
  draft,
  draftError,
  expiresAtIso,
  isDraftLoading,
  isDense,
  isPageLayout,
  isPending,
  onApplyPriceCandidate,
  onPickExpiry,
  onPickStock,
  pdName,
  pdno,
  selectedPriceCandidateId,
  setExpiresAtIso,
  setTargetPriceRaw,
  targetPriceRaw,
  targetPriceDistancePct,
  targetPriceImmediateWarning,
  todayIso,
  errors,
}: WatchConditionsSectionProps): ReactElement => (
  <section aria-label="감시조건" style={sectionCardStyle(isPageLayout)}>
    <div style={sectionHeaderStyle(isPageLayout)}>
      <span style={sectionTitleStyle(isPageLayout)}>감시조건</span>
      {draft?.rangeContext.dataQuality ? (
        <span className="chip chip--live">
          {draft.rangeContext.dataQuality === 'normal'
            ? '정상 분석'
            : draft.rangeContext.dataQuality === 'limited'
              ? '제한 분석'
              : '데이터 부족'}
        </span>
      ) : null}
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
            ...stripStyle(isPageLayout),
            background: pdno ? 'var(--accent-tint-6)' : 'var(--bg-2)',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '0.55rem',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            <strong style={{ fontSize: isPageLayout ? '1rem' : '0.92rem' }}>
              {pdName || '종목을 선택하세요'}
            </strong>
            {pdno ? <span className="num muted">{pdno}</span> : null}
          </div>
        </div>
        <QuoteStrip
          draft={draft}
          draftError={draftError}
          isDraftLoading={isDraftLoading}
          isPageLayout={isPageLayout}
          pdno={pdno}
        />
      </div>
    </AddWatchOrderFormRow>

    <PriceContextPanel
      draft={draft}
      isPageLayout={isPageLayout}
      isDense={isDense}
      isPending={isPending}
      onApplyPriceCandidate={onApplyPriceCandidate}
      selectedPriceCandidateId={selectedPriceCandidateId}
    />

    <AddWatchOrderFormRow label="감시방식">
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.45rem',
          padding: isPageLayout ? '0.55rem 0.7rem' : '0.35rem 0.5rem',
          borderRadius: '0.45rem',
          border: '0.1rem solid var(--border)',
          background: 'var(--bg-2)',
          fontSize: isPageLayout ? '0.94rem' : '0.86rem',
          color: 'var(--fg-2)',
        }}
      >
        <span className="chip chip--up">가격</span>
        <span>감시가격 이하 도달 시 예약매수 실행</span>
      </div>
    </AddWatchOrderFormRow>

    <AddWatchOrderFormRow label="감시가격" error={errors.targetPriceRaw}>
      <div style={{ display: 'grid', gap: isPageLayout ? '0.45rem' : '0.3rem' }}>
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
            aria-invalid={Boolean(errors.targetPriceRaw)}
            dense={isDense}
            disabled={isPending}
          />
          <span className="muted">원</span>
        </div>
        <div className="muted" style={{ fontSize: isPageLayout ? '0.86rem' : '0.78rem' }}>
          {targetPriceDistancePct !== null
            ? `현재가 대비 ${formatSignedPct(targetPriceDistancePct)}`
            : '현재가 확인 후 괴리율을 표시합니다.'}
        </div>
        {targetPriceImmediateWarning ? (
          <div
            className="chip chip--down"
            role="alert"
            style={{ justifySelf: 'start', whiteSpace: 'normal' }}
          >
            {targetPriceImmediateWarning}
          </div>
        ) : null}
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

function QuoteStrip({
  draft,
  draftError,
  isDraftLoading,
  isPageLayout,
  pdno,
}: {
  draft: ReservationBuyDraft | null;
  draftError: string | null;
  isDraftLoading: boolean;
  isPageLayout: boolean;
  pdno: string;
}): ReactElement | null {
  if (!pdno) return null;
  const quote = draft?.quote ?? null;
  const quoteStatus =
    quote !== null
      ? `${formatKrw(quote.price)}원`
      : isDraftLoading
        ? '현재가 확인 중'
        : draftError
          ? '현재가 조회 실패'
          : '현재가 없음';

  return (
    <div
      style={{
        ...stripStyle(isPageLayout),
        background: 'var(--bg)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem' }}>
        <span className="muted">현재가</span>
        <strong className="num">{quoteStatus}</strong>
      </div>
      {quote ? (
        <div
          className="muted"
          style={{
            display: 'flex',
            gap: '0.65rem',
            flexWrap: 'wrap',
            fontSize: isPageLayout ? '0.86rem' : '0.78rem',
          }}
        >
          <span className={quote.dayChange >= 0 ? 'chip chip--up' : 'chip chip--down'}>
            전일대비 {formatSignedKrw(quote.dayChange)}원 ({formatSignedPct(quote.dayChangeRate)})
          </span>
          <span>고가 {formatKrw(quote.high)}</span>
          <span>저가 {formatKrw(quote.low)}</span>
        </div>
      ) : null}
    </div>
  );
}

function PriceContextPanel({
  draft,
  isDense,
  isPageLayout,
  isPending,
  onApplyPriceCandidate,
  selectedPriceCandidateId,
}: {
  draft: ReservationBuyDraft | null;
  isDense: boolean;
  isPageLayout: boolean;
  isPending: boolean;
  onApplyPriceCandidate: (id: ReservationBuyPriceCandidate['id']) => void;
  selectedPriceCandidateId: ReservationBuyPriceCandidate['id'] | null;
}): ReactElement | null {
  if (!draft) return null;
  const box = draft.rangeContext.box;
  const support = draft.rangeContext.supportResistance?.supports.at(-1) ?? null;
  const resistance = draft.rangeContext.supportResistance?.resistances[0] ?? null;
  const selectedCandidate =
    draft.priceCandidates.find((candidate) => candidate.id === selectedPriceCandidateId) ?? null;
  const recommendedCandidate =
    draft.priceCandidates.find(
      (candidate) => candidate.id === draft.recommended.priceCandidateId,
    ) ?? null;
  const primaryCandidate =
    selectedCandidate ?? recommendedCandidate ?? draft.priceCandidates[0] ?? null;
  const primaryPrice = primaryCandidate?.price ?? draft.recommended.targetPrice;
  const primaryDistance =
    primaryCandidate?.distancePct ??
    (draft.quote && primaryPrice
      ? Math.round(((primaryPrice - draft.quote.price) / draft.quote.price) * 1000) / 10
      : null);

  return (
    <section
      aria-label="가격 판단"
      style={{
        display: 'grid',
        gap: isPageLayout ? '0.65rem' : '0.4rem',
        padding: isPageLayout ? '0.85rem 0' : '0.65rem 0',
        borderTop: '0.1rem solid var(--border)',
        borderBottom: '0.1rem solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem' }}>
        <strong style={panelLabelStyle()}>가격 판단</strong>
        <span className="muted" style={{ fontSize: isPageLayout ? '0.84rem' : '0.76rem' }}>
          {draft.rangeContext.dataQualityReason}
        </span>
      </div>
      <section
        aria-label="추천 감시가"
        style={{
          display: 'grid',
          gridTemplateColumns: isPageLayout ? 'minmax(0, 1fr) auto' : '1fr',
          alignItems: 'center',
          gap: isPageLayout ? '0.85rem' : '0.5rem',
          padding: isPageLayout ? '0.7rem 0.8rem' : '0.6rem 0.7rem',
          borderRadius: '0.45rem',
          border: '0.1rem solid var(--border)',
          borderLeft: '0.2rem solid var(--accent)',
          background: 'var(--bg)',
        }}
      >
        {primaryPrice !== null ? (
          <div style={{ display: 'grid', gap: '0.28rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '0.6rem',
                alignItems: 'center',
              }}
            >
              <span style={panelLabelStyle()}>추천 감시가</span>
              {primaryCandidate ? (
                <span className="chip chip--live">
                  {primaryCandidate.label} {selectedCandidate ? '선택됨' : '추천'}
                </span>
              ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.18rem' }}>
              <span className="num" style={priceValueStyle(true)}>
                {formatKrw(primaryPrice)}
              </span>
              <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--fg-2)' }}>원</span>
            </div>
            <div className="muted" style={{ fontSize: isPageLayout ? '0.9rem' : '0.84rem' }}>
              {primaryDistance !== null ? `현재가 대비 ${formatSignedPct(primaryDistance)}` : null}
              {primaryDistance !== null && primaryCandidate?.reason ? ' · ' : ''}
              {primaryCandidate?.reason ?? '일봉 데이터가 충분하지 않아 가격 추천을 보류했습니다.'}
            </div>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: isPageLayout ? '0.9rem' : '0.84rem' }}>
            일봉 30개 이상 확보 시 추천 감시가를 표시합니다.
          </div>
        )}
      </section>
      {draft.warnings.length > 0 ? (
        <div
          className="muted"
          role="status"
          style={{ fontSize: isPageLayout ? '0.86rem' : '0.78rem' }}
        >
          {draft.warnings[0]}
        </div>
      ) : null}
      <div style={candidateGridStyle(isPageLayout)}>
        {draft.priceCandidates.length > 0 ? (
          draft.priceCandidates.map((candidate) => (
            <CandidateButton
              key={candidate.id}
              candidate={candidate}
              isDense={isDense}
              isPending={isPending}
              selected={candidate.id === selectedPriceCandidateId}
              onApplyPriceCandidate={onApplyPriceCandidate}
            />
          ))
        ) : (
          <span className="muted" style={{ fontSize: isPageLayout ? '0.86rem' : '0.78rem' }}>
            추천 감시가는 일봉 30개 이상일 때 자동 표시됩니다.
          </span>
        )}
      </div>
      <section aria-label="가격 근거" style={{ display: 'grid', gap: '0.45rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem' }}>
          <span style={panelLabelStyle()}>가격 근거</span>
          <span className="muted" style={{ fontSize: isPageLayout ? '0.84rem' : '0.78rem' }}>
            박스 · 지지저항 · 호가
          </span>
        </div>
        <div style={metricRailStyle(isPageLayout)}>
          <Metric label="박스하단" value={box ? formatKrw(box.low) : '-'} />
          <Metric label="박스중앙" value={box ? formatKrw(box.mid) : '-'} />
          <Metric label="박스상단" value={box ? formatKrw(box.high) : '-'} />
          <Metric label="지지" value={support ? formatKrw(support) : '-'} />
          <Metric label="저항" value={resistance ? formatKrw(resistance) : '-'} />
          <Metric
            label="호가"
            value={
              draft.orderbookTop.bestBid && draft.orderbookTop.bestAsk
                ? `${formatKrw(draft.orderbookTop.bestBid)} / ${formatKrw(draft.orderbookTop.bestAsk)}`
                : '-'
            }
          />
        </div>
      </section>
    </section>
  );
}

function CandidateButton({
  candidate,
  isDense,
  isPending,
  selected,
  onApplyPriceCandidate,
}: {
  candidate: ReservationBuyPriceCandidate;
  isDense: boolean;
  isPending: boolean;
  selected: boolean;
  onApplyPriceCandidate: (id: ReservationBuyPriceCandidate['id']) => void;
}): ReactElement {
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => onApplyPriceCandidate(candidate.id)}
      aria-label={`${candidate.label} ${formatKrw(candidate.price)}원 적용${
        selected ? ' 선택됨' : ''
      }`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: isDense ? '0.22rem 0.4rem' : '0.28rem 0.5rem',
        minHeight: isDense ? '3.2rem' : '3.5rem',
        padding: isDense ? '0.48rem 0.58rem' : '0.55rem 0.65rem',
        borderRadius: '0.45rem',
        border: selected ? '0.1rem solid var(--accent)' : '0.1rem solid var(--border-strong)',
        background: selected ? 'var(--accent-tint-8)' : 'var(--bg)',
        boxShadow: selected ? 'inset 0.16rem 0 0 0 var(--accent)' : 'none',
        color: 'var(--fg)',
        cursor: isPending ? 'default' : 'pointer',
        opacity: isPending ? 0.55 : 1,
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: '0.4rem',
          fontSize: isDense ? '0.92rem' : '0.98rem',
          fontWeight: 800,
        }}
      >
        <span>{candidate.label}</span>
      </span>
      <span style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span className="num" style={priceValueStyle(false)}>
          {formatKrw(candidate.price)}
        </span>
        <span style={{ fontSize: '0.84rem', fontWeight: 750, color: 'var(--fg-2)' }}>원</span>
      </span>
      <span className="muted" style={{ fontSize: '0.84rem', fontWeight: 650 }}>
        현재가 대비 {formatSignedPct(candidate.distancePct)}
      </span>
      <span style={{ justifySelf: 'end' }}>
        {selected ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              color: 'var(--accent-active)',
              fontSize: '0.82rem',
              fontWeight: 800,
            }}
          >
            <Check size={12} /> 선택됨
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gap: '0.18rem',
        minWidth: 0,
        padding: '0.58rem 0.65rem',
        border: '0.1rem solid var(--border)',
        borderRadius: '0.42rem',
        background: 'var(--bg)',
      }}
    >
      <span className="muted" style={{ fontSize: '0.88rem', fontWeight: 750 }}>
        {label}
      </span>
      <strong className="num" style={{ fontSize: '1.02rem', overflowWrap: 'anywhere' }}>
        {value}
      </strong>
    </div>
  );
}

function formatKrw(value: number): string {
  return value.toLocaleString('ko-KR');
}

function formatSignedKrw(value: number): string {
  return `${value > 0 ? '+' : ''}${formatKrw(value)}`;
}

function formatSignedPct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}
