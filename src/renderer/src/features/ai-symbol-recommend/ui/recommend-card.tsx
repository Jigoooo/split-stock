import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, ExternalLink, Minus, Newspaper, Plus, Target } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import type { RecommendedItem, RecommendTier } from '../model/use-symbol-recommendations';
import { ConsensusBar } from './consensus-bar';
import { IndicatorReasonsList } from './indicator-reasons-list';

const VOL_LABEL: Record<RecommendedItem['volatilityFit'], string> = {
  low: '변동성 낮음',
  mid: '변동성 적정',
  high: '변동성 높음',
};
const VOL_TONE: Record<RecommendedItem['volatilityFit'], string> = {
  low: 'chip--down',
  mid: 'chip--live',
  high: 'chip--up',
};
const LIQ_LABEL: Record<RecommendedItem['liquidityFit'], string> = {
  good: '유동성 양호',
  ok: '유동성 보통',
  poor: '유동성 부족',
};
const LIQ_TONE: Record<RecommendedItem['liquidityFit'], string> = {
  good: 'chip--live',
  ok: 'chip',
  poor: 'chip--down',
};
const SOURCE_LABEL: Record<'OWNED' | 'WATCH' | 'MANUAL' | 'AUTO', string> = {
  OWNED: '보유',
  WATCH: '감시',
  MANUAL: '수동',
  AUTO: '자동발굴',
};

const TIER_LABEL: Record<RecommendTier, string> = {
  top: 'TOP',
  strong: 'STRONG',
  moderate: 'MODERATE',
  watch: 'WATCH',
  avoid: 'AVOID',
};
const TIER_COLOR: Record<RecommendTier, { bg: string; fg: string }> = {
  top: { bg: '#D97757', fg: '#ffffff' },
  strong: { bg: '#16a34a', fg: '#ffffff' },
  moderate: { bg: '#94a3b8', fg: '#ffffff' },
  watch: { bg: '#ca8a04', fg: '#ffffff' },
  avoid: { bg: '#d4453a', fg: '#ffffff' },
};
const CONFIDENCE_LABEL: Record<RecommendedItem['confidence'], string> = {
  high: '신뢰도 ↑',
  med: '신뢰도 중',
  low: '신뢰도 ↓',
};
const CONFIDENCE_TONE: Record<RecommendedItem['confidence'], string> = {
  high: 'chip--live',
  med: 'chip',
  low: 'chip--down',
};

export interface RecommendCardProps {
  item: RecommendedItem;
  onPick: (pdno: string, name: string) => void;
}

/**
 * AI 추천 결과 카드 — 기본 노출은 score+chip+summary, 펼침 시 통계/pros/cons/entryNote.
 * 전체 카드 클릭 = pick (add-watch-order prefill). 펼침 토글은 별도 버튼으로 분리.
 */
export const RecommendCard = ({ item, onPick }: RecommendCardProps): ReactElement => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails =
    item.pros.length > 0 ||
    item.cons.length > 0 ||
    item.entryNote !== null ||
    hasAnyStat(item.stats) ||
    item.marketContext !== null ||
    item.news.length > 0 ||
    item.indicatorReasons.length > 0 ||
    item.conflicts.length > 0 ||
    item.consensusCount > 0;

  return (
    <div
      style={{
        borderRadius: '0.6rem',
        border: '0.1rem solid var(--border)',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <motion.button
        type="button"
        onClick={() => onPick(item.pdno, item.name)}
        whileHover={{ y: -1, backgroundColor: 'var(--bg-2, rgba(0,0,0,0.03))' }}
        transition={{ duration: 0.15 }}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '1.2rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'grid',
          gap: '0.6rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.6rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--fg)' }}>
              {item.name}
            </span>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '1.1rem',
                color: 'var(--fg-2)',
              }}
            >
              ({item.pdno})
            </span>
            {item.sources.map((s) => (
              <span
                key={s}
                className="chip"
                style={{ fontSize: '0.95rem', padding: '0.1rem 0.55rem' }}
              >
                {SOURCE_LABEL[s]}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span
              style={{
                minWidth: '5.2rem',
                padding: '0.18rem 0.6rem',
                borderRadius: '0.4rem',
                fontSize: '0.95rem',
                fontWeight: 700,
                textAlign: 'center',
                background: TIER_COLOR[item.tier].bg,
                color: TIER_COLOR[item.tier].fg,
              }}
            >
              {TIER_LABEL[item.tier]}
            </span>
            <span className="chip" style={{ minWidth: '4.4rem', justifyContent: 'center' }}>
              {item.score}점
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className={`chip ${VOL_TONE[item.volatilityFit]}`}>
            {VOL_LABEL[item.volatilityFit]}
          </span>
          <span className={`chip ${LIQ_TONE[item.liquidityFit]}`}>
            {LIQ_LABEL[item.liquidityFit]}
          </span>
          <span className={`chip ${CONFIDENCE_TONE[item.confidence]}`}>
            {CONFIDENCE_LABEL[item.confidence]}
          </span>
          {item.consensusCount > 0 ? (
            <span
              className="chip"
              style={{ fontSize: '0.95rem' }}
              title="BB/RSI/MFI/Stoch/CCI/momentum 중 동의한 지표 수"
            >
              합의 {item.consensusCount}
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: '1.15rem', color: 'var(--fg)', lineHeight: 1.5 }}>
          {item.summary}
        </div>
      </motion.button>

      {hasDetails ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            style={{
              width: '100%',
              padding: '0.5rem 1.2rem',
              border: 'none',
              borderTop: '0.1rem solid var(--border)',
              background: 'var(--bg-2, rgba(0,0,0,0.02))',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              fontSize: '1rem',
              color: 'var(--fg-2)',
            }}
          >
            {expanded ? (
              <>
                <ChevronUp size={12} /> 접기
              </>
            ) : (
              <>
                <ChevronDown size={12} /> 상세 보기
              </>
            )}
          </button>
          <AnimatePresence initial={false}>
            {expanded ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ padding: '1rem 1.2rem', display: 'grid', gap: '0.9rem' }}>
                  {/* 섹션 1 — 기본 진단 */}
                  {hasAnyStat(item.stats) ? <StatRow stats={item.stats} /> : null}
                  {item.marketContext ? <MarketContextRow context={item.marketContext} /> : null}
                  {/* 섹션 2 — 지표별 사유 */}
                  {item.indicatorReasons.length > 0 ? (
                    <IndicatorReasonsList reasons={item.indicatorReasons} />
                  ) : null}
                  {/* 섹션 3 — 합의·충돌 + 도구 호출 */}
                  {item.consensusCount > 0 ||
                  item.conflicts.length > 0 ||
                  item.citedTools.length > 0 ? (
                    <ConsensusBar
                      count={item.consensusCount}
                      conflicts={item.conflicts}
                      citedTools={item.citedTools}
                    />
                  ) : null}
                  {/* 섹션 4 — pros/cons + 진입 가이드 + 뉴스 */}
                  {item.pros.length > 0 ? <ProConList items={item.pros} kind="pro" /> : null}
                  {item.cons.length > 0 ? <ProConList items={item.cons} kind="con" /> : null}
                  {item.entryNote ? <EntryNote note={item.entryNote} /> : null}
                  {item.news.length > 0 ? <NewsSection news={item.news} /> : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      ) : null}
    </div>
  );
};

function hasAnyStat(s: RecommendedItem['stats']): boolean {
  return (
    s.lastClose !== null ||
    s.volatility60d !== null ||
    s.avgVolume60d !== null ||
    s.rangePct120d !== null
  );
}

function StatRow({ stats }: { stats: RecommendedItem['stats'] }): ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
        gap: '0.6rem',
      }}
    >
      <StatCell
        label="최근 종가"
        value={stats.lastClose !== null ? `${stats.lastClose.toLocaleString()}원` : '—'}
      />
      <StatCell
        label="60일 변동성"
        value={stats.volatility60d !== null ? `${stats.volatility60d}%` : '—'}
      />
      <StatCell
        label="60일 평균 거래량"
        value={stats.avgVolume60d !== null ? `${stats.avgVolume60d.toLocaleString()}주` : '—'}
      />
      <StatCell
        label="120일 박스권 폭"
        value={stats.rangePct120d !== null ? `${stats.rangePct120d}%` : '—'}
      />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div
      style={{
        padding: '0.55rem 0.7rem',
        borderRadius: '0.4rem',
        border: '0.1rem solid var(--border)',
        background: 'var(--bg)',
      }}
    >
      <div style={{ fontSize: '0.95rem', color: 'var(--fg-2)', marginBottom: '0.2rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--fg)' }}>{value}</div>
    </div>
  );
}

function MarketContextRow({
  context,
}: {
  context: NonNullable<RecommendedItem['marketContext']>;
}): ReactElement | null {
  const cells: Array<{ label: string; value: string }> = [];
  if (context.krx) {
    cells.push(
      {
        label: 'KRX 종가',
        value:
          context.krx.close !== null
            ? `${context.krx.close.toLocaleString()}원 (${context.krx.date})`
            : `— (${context.krx.date})`,
      },
      {
        label: 'KRX 등락률',
        value: context.krx.changeRate !== null ? `${context.krx.changeRate}%` : '—',
      },
    );
    if (context.krx.marketCap !== null) {
      cells.push({ label: 'KRX 시가총액', value: formatKrw(context.krx.marketCap) });
    }
  }
  for (const point of context.ecos) {
    cells.push({
      label: `ECOS ${indicatorLabel(point.indicator)}`,
      value: `${point.value.toLocaleString()}${point.unitName ?? ''} (${point.date})`,
    });
  }
  if (cells.length === 0) return null;

  const statusTitle = [
    context.status.krx.isStale ? 'KRX stale' : null,
    context.status.ecos.isStale ? 'ECOS stale' : null,
    context.status.krx.lastError ? `KRX: ${context.status.krx.lastError}` : null,
    context.status.ecos.lastError ? `ECOS: ${context.status.ecos.lastError}` : null,
  ]
    .filter(Boolean)
    .join(' / ');

  return (
    <div
      title={statusTitle || undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
        gap: '0.6rem',
      }}
    >
      {cells.map((cell) => (
        <StatCell key={`${cell.label}:${cell.value}`} label={cell.label} value={cell.value} />
      ))}
    </div>
  );
}

function indicatorLabel(indicator: string): string {
  if (indicator === 'usdKrw') return 'USD/KRW';
  if (indicator === 'callRate') return '콜금리';
  return indicator;
}

function formatKrw(value: number): string {
  if (value >= 1_0000_0000_0000) return `${(value / 1_0000_0000_0000).toFixed(1)}조원`;
  if (value >= 1_0000_0000) return `${Math.round(value / 1_0000_0000).toLocaleString()}억원`;
  return `${value.toLocaleString()}원`;
}

function ProConList({
  items,
  kind,
}: {
  items: ReadonlyArray<string>;
  kind: 'pro' | 'con';
}): ReactElement {
  const isPro = kind === 'pro';
  const heading = isPro ? '강점' : '주의점';
  const accent = isPro ? 'var(--up, #d4453a)' : 'var(--down, #2563eb)';
  const Icon = isPro ? Plus : Minus;
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginBottom: '0.4rem',
          color: accent,
          fontWeight: 700,
          fontSize: '1.05rem',
        }}
      >
        <Icon size={14} />
        {heading}
      </div>
      <ul style={{ margin: 0, paddingLeft: '1.4rem', display: 'grid', gap: '0.25rem' }}>
        {items.map((it) => (
          <li key={it} style={{ fontSize: '1.1rem', color: 'var(--fg)', lineHeight: 1.5 }}>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewsSection({ news }: { news: RecommendedItem['news'] }): ReactElement {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginBottom: '0.4rem',
          color: 'var(--fg-2)',
          fontWeight: 700,
          fontSize: '1.05rem',
        }}
      >
        <Newspaper size={14} />
        참조 뉴스 ({news.length})
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.4rem' }}>
        {news.map((n) => (
          <li
            key={n.link}
            style={{
              padding: '0.55rem 0.7rem',
              borderRadius: '0.4rem',
              border: '0.1rem solid var(--border)',
              background: 'var(--bg)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                marginBottom: '0.25rem',
              }}
            >
              <span style={{ fontSize: '0.95rem', color: 'var(--fg-2)' }}>{n.publishedAt}</span>
              <a
                href={n.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={n.link}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  fontSize: '0.95rem',
                  color: '#D97757',
                  textDecoration: 'none',
                }}
              >
                원문 <ExternalLink size={10} />
              </a>
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--fg)' }}>{n.title}</div>
            {n.summary ? (
              <div
                style={{
                  fontSize: '1rem',
                  color: 'var(--fg-2)',
                  lineHeight: 1.5,
                  marginTop: '0.25rem',
                }}
              >
                {n.summary}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntryNote({ note }: { note: string }): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        padding: '0.7rem 0.9rem',
        borderRadius: '0.5rem',
        border: '0.1rem solid #D97757',
        backgroundColor: 'rgba(217, 119, 87, 0.08)',
      }}
    >
      <Target size={14} color="#D97757" style={{ flexShrink: 0, marginTop: '0.2rem' }} />
      <div style={{ fontSize: '1.1rem', color: 'var(--fg)', lineHeight: 1.5 }}>
        <span style={{ color: '#D97757', fontWeight: 700 }}>진입 가이드</span> · {note}
      </div>
    </div>
  );
}
