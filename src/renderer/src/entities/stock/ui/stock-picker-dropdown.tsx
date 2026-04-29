import { Z_INDEX } from '@renderer/shared/config';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { highlightMatches } from '@renderer/shared/lib/search';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactElement } from 'react';
import type { StockListEntry } from '../model/use-stock-list';

interface Props {
  open: boolean;
  alwaysOpen: boolean;
  isLoading: boolean;
  visible: StockListEntry[];
  totalCount: number;
  activeIndex: number;
  selectedPdno: string | undefined;
  keyword: string;
  rowHeightPx: number;
  dense: boolean;
  onCommit: (entry: StockListEntry) => void;
  onHoverIndex: (idx: number) => void;
}

/**
 * stock picker 의 드롭다운 listbox.
 * - alwaysOpen 이면 motion 애니메이션 없이 펼친 상태로 렌더 (팝아웃 창 전용)
 * - 로딩 / 빈 결과 / 항목 목록 / "상위 N건 표시 중" 안내 분기
 */
export const StockPickerDropdown = ({
  open,
  alwaysOpen,
  isLoading,
  visible,
  totalCount,
  activeIndex,
  selectedPdno,
  keyword,
  rowHeightPx,
  dense,
  onCommit,
  onHoverIndex,
}: Props): ReactElement => {
  const motionProps = alwaysOpen
    ? {}
    : {
        initial: { opacity: 0, y: -3 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -3 },
      };

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          role="listbox"
          aria-label="종목 검색 결과"
          className="panel"
          transition={{ duration: 0.1 }}
          {...motionProps}
          style={{
            position: alwaysOpen ? 'relative' : 'absolute',
            top: alwaysOpen ? undefined : '100%',
            left: 0,
            right: 0,
            marginTop: '0.3rem',
            zIndex: Z_INDEX.CONTROL_POPUP,
            maxHeight: alwaysOpen ? undefined : '28rem',
            height: alwaysOpen ? '100%' : undefined,
            overflowY: 'auto',
            flex: alwaysOpen ? 1 : undefined,
            minHeight: alwaysOpen ? 0 : undefined,
          }}
        >
          {isLoading ? (
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
                    onCommit(entry);
                  }}
                  onMouseEnter={() => onHoverIndex(idx)}
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
          {!alwaysOpen && totalCount > visible.length ? (
            <div className="panel__body muted" style={{ fontSize: '1rem' }}>
              상위 {visible.length}건 표시 중 · 전체 {thousandSeparator(totalCount)}건
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
