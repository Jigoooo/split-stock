import type { KeyboardEvent, ReactElement } from 'react';
import { useRef } from 'react';

export interface HtsTabItem<Id extends string = string> {
  id: Id;
  label: string;
  /** 우측 정렬 보조 라벨(선택). 예: 카운트 chip */
  badge?: string | number;
}

export interface HtsTabsProps<Id extends string = string> {
  tabs: ReadonlyArray<HtsTabItem<Id>>;
  active: Id;
  onChange: (id: Id) => void;
  /** 추가 우측 영역(선택). 탭 라인 우측에 작은 액션 버튼 등을 둘 때. */
  trailing?: ReactElement;
  ariaLabel?: string;
}

/**
 * HTS 스타일 전통 탭.
 * - 상단 버튼탭 X. 하단 1px line + 활성 탭만 -2px 컬러 보더.
 * - 비활성: 회색 텍스트, 활성: 강조 색상 + 굵은 폰트.
 * - 키보드: ←/→ 이동, Home/End 처음/끝.
 *
 * 디자인 토큰 (CSS variables) 사용 — 미정의 시 fallback 색.
 *   --hts-line  : 탭 라인 색
 *   --hts-text  : 활성 텍스트 색 (없으면 inherit)
 *   --hts-muted : 비활성 텍스트 색
 *   --up        : 활성 보더 강조 색 (KOSPI 상승색을 재사용)
 */
export function HtsTabs<Id extends string = string>(props: HtsTabsProps<Id>): ReactElement {
  const { tabs, active, onChange, trailing, ariaLabel } = props;
  const listRef = useRef<HTMLDivElement>(null);

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number): void => {
    const last = tabs.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight') next = idx === last ? 0 : idx + 1;
    else if (e.key === 'ArrowLeft') next = idx === 0 ? last : idx - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === -1) return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    const nextEl = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    nextEl?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      ref={listRef}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: '0.2rem',
        borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.12))',
        // 활성 탭의 -2px 보더가 자연스럽게 라인을 덮도록 약간 -1px 마진 사용 가능하나, 단순화함.
      }}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`hts-tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`hts-tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKey(e, idx)}
            style={{
              padding: '0.4rem 0.9rem',
              fontSize: '1.1rem',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--hts-text, inherit)' : 'var(--hts-muted, rgba(0,0,0,0.55))',
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--up, #c0392b)' : '2px solid transparent',
              marginBottom: '-1px', // 라인 위로 살짝 올라가 active border 가 라인을 덮음
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {tab.label}
            {tab.badge !== undefined ? (
              <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.95rem' }}>
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
      {trailing ? (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{trailing}</div>
      ) : null}
    </div>
  );
}
