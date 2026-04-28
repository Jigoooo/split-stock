import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface WatchContextMenuState {
  x: number;
  y: number;
  ids: number[];
}

const MENU_VIEWPORT_PADDING = 8;

interface WatchContextMenuProps {
  allowEdit: boolean;
  allowMutations: boolean;
  canPause: boolean;
  canResume: boolean;
  menu: WatchContextMenuState;
  mutationPending: boolean;
  onClose: () => void;
  onDelete: (ids: number[]) => void;
  onEdit: () => void;
  onPause: (ids: number[]) => void;
  onResume: (ids: number[]) => void;
}

interface MenuItemProps {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

const MenuItem = ({ disabled = false, label, onSelect }: MenuItemProps): ReactElement => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={onSelect}
    style={{
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '0.35rem 0.8rem',
      background: 'transparent',
      border: 'none',
      cursor: disabled ? 'default' : 'pointer',
      color: disabled ? 'var(--hts-muted, rgba(0,0,0,0.4))' : 'inherit',
      fontSize: 'inherit',
    }}
  >
    {label}
  </button>
);

export const WatchContextMenu = ({
  allowEdit,
  allowMutations,
  canPause,
  canResume,
  menu,
  mutationPending,
  onClose,
  onDelete,
  onEdit,
  onPause,
  onResume,
}: WatchContextMenuProps): ReactElement => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: menu.y, left: menu.x });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - MENU_VIEWPORT_PADDING;
    const maxTop = window.innerHeight - rect.height - MENU_VIEWPORT_PADDING;
    setPos({
      left: Math.max(MENU_VIEWPORT_PADDING, Math.min(menu.x, maxLeft)),
      top: Math.max(MENU_VIEWPORT_PADDING, Math.min(menu.y, maxTop)),
    });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const firstEnabled = menuRef.current?.querySelector<HTMLButtonElement>(
      'button[role="menuitem"]:not(:disabled)',
    );
    firstEnabled?.focus();
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label="컨텍스트 메뉴 닫기"
        onClick={onClose}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'default',
          zIndex: 999,
          padding: 0,
        }}
      />
      <div
        ref={menuRef}
        data-testid="watch-context-menu"
        role="menu"
        aria-label={`자동감시 작업 (${menu.ids.length}건)`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const items = Array.from(
            menuRef.current?.querySelectorAll<HTMLButtonElement>(
              'button[role="menuitem"]:not(:disabled)',
            ) ?? [],
          );
          const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          const next = items[(currentIndex + direction + items.length) % items.length];
          next?.focus();
        }}
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          background: 'var(--bg, #fff)',
          border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          padding: '0.25rem 0',
          zIndex: 1000,
          minWidth: '8rem',
          fontSize: '1.1rem',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <MenuItem
          disabled={!allowMutations || !canResume || mutationPending}
          label={`시작 (${menu.ids.length}건)`}
          onSelect={() => onResume(menu.ids)}
        />
        <MenuItem
          disabled={!allowMutations || !canPause || mutationPending}
          label={`중지 (${menu.ids.length}건)`}
          onSelect={() => onPause(menu.ids)}
        />
        {allowEdit ? <MenuItem disabled={mutationPending} label="수정" onSelect={onEdit} /> : null}
        <MenuItem
          disabled={!allowMutations || mutationPending}
          label={`삭제 (${menu.ids.length}건)`}
          onSelect={() => onDelete(menu.ids)}
        />
      </div>
    </>
  );
};
