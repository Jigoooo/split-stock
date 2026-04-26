import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Minus, Plus, Target } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import type { RecommendedItem } from '../model/use-symbol-recommendations';

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
const SOURCE_LABEL: Record<'OWNED' | 'WATCH' | 'MANUAL', string> = {
  OWNED: '보유',
  WATCH: '감시',
  MANUAL: '수동',
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
    hasAnyStat(item.stats);

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
          <span
            className="chip chip--live"
            style={{ minWidth: '4.4rem', justifyContent: 'center' }}
          >
            {item.score}점
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className={`chip ${VOL_TONE[item.volatilityFit]}`}>
            {VOL_LABEL[item.volatilityFit]}
          </span>
          <span className={`chip ${LIQ_TONE[item.liquidityFit]}`}>
            {LIQ_LABEL[item.liquidityFit]}
          </span>
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
                  {hasAnyStat(item.stats) ? <StatRow stats={item.stats} /> : null}
                  {item.pros.length > 0 ? <ProConList items={item.pros} kind="pro" /> : null}
                  {item.cons.length > 0 ? <ProConList items={item.cons} kind="con" /> : null}
                  {item.entryNote ? <EntryNote note={item.entryNote} /> : null}
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
