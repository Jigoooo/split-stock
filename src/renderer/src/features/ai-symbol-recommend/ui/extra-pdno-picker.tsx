import { trpc } from '@renderer/shared/api/trpc';
import { TextInput } from '@renderer/shared/ui';
import { Plus, Search, X } from 'lucide-react';
import { type ReactElement, useState } from 'react';

export interface ExtraPdnoPickerProps {
  extras: ReadonlyArray<string>;
  onAdd: (pdno: string) => void;
  onRemove: (pdno: string) => void;
  /** 최대 개수. 기본 10. */
  max?: number;
}

/**
 * AI 추천 모달 상단의 "관심 종목 추가" 검색기 — 보유/감시에 없는 종목을 풀에 합치기.
 * 사용자가 입력한 키워드로 stock_master 검색 → 클릭 시 extras 에 추가.
 * 추가된 항목은 chip 형태로 표시 + X 제거.
 */
export const ExtraPdnoPicker = ({
  extras,
  onAdd,
  onRemove,
  max = 10,
}: ExtraPdnoPickerProps): ReactElement => {
  const [keyword, setKeyword] = useState('');
  const trimmed = keyword.trim();
  const enabled = trimmed.length >= 1;

  const search = trpc.market.searchStock.useQuery(
    { term: trimmed, limit: 6 },
    { enabled, staleTime: 30_000 },
  );
  const matches = search.data?.entries ?? [];
  const reachedMax = extras.length >= max;

  return (
    <div
      style={{
        border: '0.1rem solid var(--border)',
        borderRadius: '0.6rem',
        padding: '0.8rem',
        backgroundColor: 'var(--bg-2, rgba(0,0,0,0.02))',
        display: 'grid',
        gap: '0.6rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <span style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--fg)' }}>
          관심 종목 추가
        </span>
        <span className="muted" style={{ fontSize: '1rem' }}>
          {extras.length}/{max}
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <TextInput
          dense
          iconLeading={<Search size={14} />}
          placeholder={
            reachedMax
              ? `최대 ${max}개까지 추가 가능합니다`
              : '종목명 또는 6자리 코드 입력 (예: 삼성전자, 005930)'
          }
          value={keyword}
          onChange={(e) => setKeyword(e.currentTarget.value)}
          disabled={reachedMax}
        />
        {enabled && !reachedMax && matches.length > 0 ? (
          <div
            style={{
              marginTop: '0.4rem',
              display: 'grid',
              gap: '0.2rem',
              maxHeight: '18rem',
              overflowY: 'auto',
            }}
          >
            {matches.slice(0, 6).map((m) => {
              const already = extras.includes(m.pdno);
              return (
                <button
                  key={m.pdno}
                  type="button"
                  disabled={already}
                  onClick={() => {
                    onAdd(m.pdno);
                    setKeyword('');
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.6rem',
                    padding: '0.5rem 0.7rem',
                    borderRadius: '0.4rem',
                    border: '0.1rem solid var(--border)',
                    background: already ? 'var(--bg-2, rgba(0,0,0,0.04))' : 'var(--bg)',
                    cursor: already ? 'default' : 'pointer',
                    fontSize: '1.15rem',
                    color: 'var(--fg)',
                    textAlign: 'left',
                    opacity: already ? 0.55 : 1,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '1rem',
                      color: 'var(--fg-2)',
                    }}
                  >
                    {m.pdno}
                  </span>
                  {already ? (
                    <span style={{ fontSize: '0.95rem', color: 'var(--fg-2)' }}>추가됨</span>
                  ) : (
                    <Plus size={12} color="#D97757" />
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {extras.length > 0 ? (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {extras.map((p) => (
            <span
              key={p}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.25rem 0.6rem',
                fontSize: '1.05rem',
                borderRadius: '999px',
                border: '0.1rem solid #D97757',
                backgroundColor: 'rgba(217, 119, 87, 0.08)',
                color: '#D97757',
                fontFamily: 'monospace',
              }}
            >
              {p}
              <button
                type="button"
                aria-label={`${p} 제거`}
                onClick={() => onRemove(p)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: '#D97757',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};
