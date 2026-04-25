import { Button, TextInput } from '@renderer/shared/ui';
import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import type { ChangeEvent, CompositionEvent, KeyboardEvent, ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { StockListEntry } from '../model/use-stock-list';
import { useStockList } from '../model/use-stock-list';
import { useStockMasterSync } from '../model/use-stock-master-sync';
import { StockPickerDropdown } from './stock-picker-dropdown';

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
 * - 포커스/입력 시에만 드롭다운(StockPickerDropdown) 노출 (`alwaysOpen` 으로 강제 노출 가능)
 * - 한글 초성/퍼지/띄어쓰기 검색 (createKoreanSearchRegex) + 매칭 하이라이트
 *
 * 본 파일은 입력 / IME / 키보드 네비게이션 / 마스터 sync 액션을 다루고, 드롭다운 렌더는
 * StockPickerDropdown 으로 위임한다.
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
  const isComposingRef = useRef(false);
  const pendingEnterSelectionRef = useRef<StockListEntry | null>(null);
  const suppressNextChangeRef = useRef(false);
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

  const commit = (entry: StockListEntry): void => {
    pendingEnterSelectionRef.current = null;
    onSelect(entry);
    if (!alwaysOpen) {
      setKeyword('');
      setFocused(false);
      setActiveIndex(0);
    }
  };

  const handleKeywordChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (suppressNextChangeRef.current) {
      suppressNextChangeRef.current = false;
      return;
    }

    setKeyword(event.target.value);
    setActiveIndex(0);
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
      const nativeEvent = e.nativeEvent as KeyboardEvent<HTMLInputElement>['nativeEvent'] & {
        isComposing?: boolean;
        keyCode?: number;
      };
      if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        e.preventDefault();
        pendingEnterSelectionRef.current = visible[activeIndex] ?? null;
        return;
      }
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
          onChange={handleKeywordChange}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(event: CompositionEvent<HTMLInputElement>) => {
            isComposingRef.current = false;
            handleKeywordChange(event as unknown as ChangeEvent<HTMLInputElement>);

            const pendingEntry = pendingEnterSelectionRef.current;
            if (!pendingEntry) return;

            suppressNextChangeRef.current = true;
            commit(pendingEntry);
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
      <StockPickerDropdown
        open={open}
        alwaysOpen={alwaysOpen}
        isLoading={list.isLoading}
        visible={visible}
        totalCount={list.entries.length}
        activeIndex={activeIndex}
        selectedPdno={selectedPdno}
        keyword={keyword}
        rowHeightPx={rowHeightPx}
        dense={dense}
        onCommit={commit}
        onHoverIndex={setActiveIndex}
      />
    </div>
  );
};
