import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { highlightMatches } from '@renderer/shared/lib/search';
import { Button, TextInput } from '@renderer/shared/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import type { KeyboardEvent, ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { StockListEntry } from '../model/use-stock-list';
import { useStockList } from '../model/use-stock-list';
import { useStockMasterSync } from '../model/use-stock-master-sync';

const MAX_VISIBLE = 40;

export interface StockPickerListProps {
  selectedPdno?: string;
  onSelect: (entry: StockListEntry) => void;
  placeholder?: string;
  inputAriaLabel?: string;
  dense?: boolean;
  hideSyncButton?: boolean;
  /** true면 ExternalLink(팝아웃) 버튼 숨김 — 팝아웃 창 내부 사용 등 */
  hidePopoutButton?: boolean;
  /** true면 펼친 목록 모드 (팝아웃 창 전용) — 포커스와 무관하게 항상 목록 표시 */
  alwaysOpen?: boolean;
  maxVisible?: number;
  onOpenPopout?: (() => Promise<void> | void) | undefined;
  isPopoutOpen?: boolean | undefined;
}

/**
 * 종목 검색 autocomplete 콤보박스.
 * - 상단: lucide Search 아이콘 + 인풋 + ExternalLink 팝아웃 + RefreshCw(마스터 동기화)
 * - 포커스/입력 시에만 드롭다운이 인풋 아래 표시 (`alwaysOpen`으로 강제 노출 가능)
 * - 한글 초성/퍼지/띄어쓰기 검색 (createKoreanSearchRegex) + 매칭 하이라이트
 */
export const StockPickerList = (props: StockPickerListProps): ReactElement => {
  const {
    selectedPdno,
    onSelect,
    placeholder = '종목을 검색하세요',
    inputAriaLabel = '종목 검색',
    dense = true,
    hideSyncButton = false,
    hidePopoutButton = false,
    alwaysOpen = false,
    maxVisible = MAX_VISIBLE,
  } = props;
  const { onOpenPopout, isPopoutOpen = false } = props;
  const [keyword, setKeyword] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const list = useStockList(keyword);
  const { isEmpty, sync, syncError, syncPending } = useStockMasterSync();
  const containerRef = useRef<HTMLDivElement>(null);
  const rowHeightPx = dense ? 34 : 40;

  // 문서 다른 곳 클릭 시 드롭다운 닫힘
  useEffect(() => {
    if (alwaysOpen) return;
    const onDoc = (e: MouseEvent): void => {
      if (!containerRef.current || containerRef.current.contains(e.target as Node)) return;
      setFocused(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [alwaysOpen]);

  const visible = alwaysOpen ? list.entries : list.entries.slice(0, maxVisible);
  const open = alwaysOpen || (focused && keyword.trim().length > 0);
  const dropdownMotionProps = alwaysOpen
    ? {}
    : {
        initial: { opacity: 0, y: -3 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -3 },
      };

  const commit = (entry: StockListEntry): void => {
    onSelect(entry);
    if (!alwaysOpen) {
      setKeyword('');
      setFocused(false);
      setActiveIndex(0);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!open || visible.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(visible.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = visible[activeIndex];
      if (hit) commit(hit);
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'visible' }}>
        <TextInput
          type="text"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setActiveIndex(0);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label={inputAriaLabel}
          autoComplete="off"
          iconLeading={<Search size={14} />}
          dense={dense}
          style={{ width: '100%' }}
        />
        {!hideSyncButton ? (
          <Button
            disabled={syncPending}
            onClick={sync}
            aria-label="종목 마스터 재동기화"
            title="KIS 마스터 파일 다시 다운로드"
            iconOnly
            dense={dense}
            iconLeading={<RefreshCw size={14} />}
          >
            종목 마스터 재동기화
          </Button>
        ) : null}
        {!hidePopoutButton && onOpenPopout ? (
          <Button
            onClick={() => {
              void onOpenPopout();
            }}
            aria-pressed={isPopoutOpen}
            aria-label="종목 선택 팝아웃 창"
            title={isPopoutOpen ? '별도 창에서 검색/할당 중' : '별도 창에서 검색/할당'}
            iconOnly
            dense={dense}
            iconLeading={<ExternalLink size={14} />}
            variant={isPopoutOpen ? 'primary' : 'default'}
          >
            종목 선택 팝아웃
          </Button>
        ) : null}
      </div>
      {syncError ? (
        <span className="chip chip--down" style={{ marginTop: 6 }}>
          {syncError}
        </span>
      ) : null}
      {isEmpty ? (
        <div className="muted" style={{ marginTop: 6 }}>
          종목 마스터가 비어 있습니다. 새로고침 아이콘으로 받아오세요.
        </div>
      ) : null}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            role="listbox"
            aria-label="종목 검색 결과"
            className="panel"
            transition={{ duration: 0.1 }}
            {...dropdownMotionProps}
            style={{
              position: alwaysOpen ? 'relative' : 'absolute',
              top: alwaysOpen ? undefined : '100%',
              left: 0,
              right: 0,
              marginTop: '0.3rem',
              zIndex: 10,
              maxHeight: alwaysOpen ? undefined : '28rem',
              height: alwaysOpen ? '100%' : undefined,
              overflowY: 'auto',
              flex: alwaysOpen ? 1 : undefined,
              minHeight: alwaysOpen ? 0 : undefined,
            }}
          >
            {list.isLoading ? (
              <div className="panel__body muted">로딩 중…</div>
            ) : visible.length === 0 ? (
              <div className="panel__body muted">결과 없음</div>
            ) : (
              visible.map((entry, idx) => {
                const isActive = idx === activeIndex;
                const isSelected = entry.pdno === selectedPdno;
                return (
                  <button
                    type="button"
                    key={entry.pdno}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(entry);
                    }}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={isActive ? 'hts-btn hts-btn--primary' : 'hts-btn'}
                    style={{
                      width: '100%',
                      height: rowHeightPx,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      gap: '0.8rem',
                      borderRadius: 0,
                      padding: dense ? '0 0.8rem' : '0 1rem',
                      textAlign: 'left',
                      background: isSelected && !isActive ? 'var(--up-soft)' : undefined,
                    }}
                  >
                    <span className="num" style={{ minWidth: '6rem' }}>
                      {highlightMatches(entry.pdno, keyword)}
                    </span>
                    <span style={{ flex: 1 }}>{highlightMatches(entry.name, keyword)}</span>
                    {entry.sector ? <span className="muted">{entry.sector}</span> : null}
                  </button>
                );
              })
            )}
            {!alwaysOpen && list.entries.length > visible.length ? (
              <div className="panel__body muted" style={{ fontSize: '1rem' }}>
                상위 {visible.length}건 표시 중 · 전체 {thousandSeparator(list.entries.length)}건
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
