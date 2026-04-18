import type { KeyboardEvent, ReactElement } from 'react';
import { useState } from 'react';
import type { StockHit } from '../model/use-stock-search';
import { useStockSearch } from '../model/use-stock-search';

export interface SearchStockInputProps {
  placeholder?: string;
  limit?: number;
  onSelect: (hit: StockHit) => void;
}

/**
 * 종목 검색 드롭다운.
 * - 400ms debounce 입력
 * - 키보드 ArrowUp/ArrowDown/Enter 지원
 * - 빈 입력: 드롭다운 접힘
 * - 로딩/빈 결과/정상 결과 상태 구분
 */
export const SearchStockInput = (props: SearchStockInputProps): ReactElement => {
  const { placeholder = '종목명 또는 코드 검색', limit = 20, onSelect } = props;
  const [term, setTerm] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const search = useStockSearch(term, { limit });

  const open = focused && term.trim().length > 0;
  const list = search.results;

  const commit = (hit: StockHit): void => {
    onSelect(hit);
    setTerm('');
    setActiveIndex(0);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!open || list.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = list[activeIndex];
      if (hit) commit(hit);
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setActiveIndex(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={onKey}
        placeholder={placeholder}
        aria-label="종목 검색 입력"
        style={{ width: '100%' }}
      />
      {open ? (
        <div
          role="listbox"
          aria-label="종목 검색 결과"
          className="panel"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '0.3rem',
            zIndex: 10,
            maxHeight: '28rem',
            overflowY: 'auto',
          }}
        >
          {search.isLoading ? (
            <div className="panel__body muted">검색 중…</div>
          ) : search.error ? (
            <div className="panel__body">
              <span className="chip chip--down">{search.error.message}</span>
            </div>
          ) : list.length === 0 ? (
            <div className="panel__body muted">결과 없음</div>
          ) : (
            list.map((hit, idx) => (
              <button
                type="button"
                key={hit.pdno}
                role="option"
                aria-selected={idx === activeIndex}
                className={idx === activeIndex ? 'hts-btn hts-btn--primary' : 'hts-btn'}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(hit);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                style={{
                  display: 'flex',
                  gap: '0.8rem',
                  width: '100%',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  borderRadius: 0,
                }}
              >
                <span className="num" style={{ minWidth: '6rem' }}>
                  {hit.pdno}
                </span>
                <span>{hit.name}</span>
                {hit.sector ? <span className="muted">{hit.sector}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
};
