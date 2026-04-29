import { Z_INDEX } from '@renderer/shared/config';
import { EmptyState, TextInput } from '@renderer/shared/ui';
import { Search } from 'lucide-react';
import type { CompositionEvent, KeyboardEvent, ReactElement } from 'react';
import { useId, useRef, useState } from 'react';
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
  const listboxId = useId();
  const [term, setTerm] = useState('');
  // 검색에 실제 사용되는 query — IME 조합 중에는 직전 commit 값을 유지해
  // 자모 한 글자마다 backend 쿼리가 발생하지 않도록 한다.
  const [committedTerm, setCommittedTerm] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const pendingEnterSelectionRef = useRef<StockHit | null>(null);
  const search = useStockSearch(committedTerm, { limit });

  const open = focused && committedTerm.trim().length > 0;
  const list = search.results;

  const commit = (hit: StockHit): void => {
    pendingEnterSelectionRef.current = null;
    onSelect(hit);
    setTerm('');
    setCommittedTerm('');
    setActiveIndex(0);
    setFocused(false);
  };

  const handleChange = (value: string): void => {
    setTerm(value);
    setActiveIndex(0);
    // 조합 중이면 committed 갱신을 미룬다. 조합 종료 시 onCompositionEnd 가 마지막 값으로 동기화.
    if (!composingRef.current) setCommittedTerm(value);
  };

  const handleCompositionStart = (): void => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (e: CompositionEvent<HTMLInputElement>): void => {
    composingRef.current = false;
    setCommittedTerm(e.currentTarget.value);
    const pendingEntry = pendingEnterSelectionRef.current;
    if (pendingEntry) commit(pendingEntry);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      setFocused(false);
      return;
    }
    if (!open || list.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      const nativeEvent = e.nativeEvent as KeyboardEvent<HTMLInputElement>['nativeEvent'] & {
        isComposing?: boolean;
        keyCode?: number;
      };
      if (composingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        e.preventDefault();
        pendingEnterSelectionRef.current = list[activeIndex] ?? null;
        return;
      }
      e.preventDefault();
      const hit = list[activeIndex];
      if (hit) commit(hit);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <TextInput
        type="text"
        value={term}
        onChange={(e) => handleChange(e.target.value)}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && containerRef.current?.contains(nextTarget)) return;
          setFocused(false);
        }}
        onKeyDown={onKey}
        placeholder={placeholder}
        aria-label="종목 검색 입력"
        aria-autocomplete="list"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-activedescendant={
          open && list[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
        }
        role="combobox"
        autoComplete="off"
        iconLeading={<Search size={14} />}
        dense
        style={{ width: '100%' }}
      />
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="종목 검색 결과"
          className="panel"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '0.3rem',
            zIndex: Z_INDEX.CONTROL_POPUP,
            maxHeight: '28rem',
            overflowY: 'auto',
          }}
        >
          {search.isLoading ? (
            <EmptyState dense title="검색 중…" />
          ) : search.error ? (
            <EmptyState dense role="alert" title="검색 실패" description={search.error.message} />
          ) : list.length === 0 ? (
            <EmptyState dense title="결과 없음" />
          ) : (
            list.map((hit, idx) => (
              <button
                type="button"
                key={hit.pdno}
                id={`${listboxId}-${idx}`}
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
