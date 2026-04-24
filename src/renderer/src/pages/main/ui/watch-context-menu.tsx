import type { ReactElement } from 'react';

export interface WatchContextMenuState {
  x: number;
  y: number;
  ids: number[];
}

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
}: WatchContextMenuProps): ReactElement => (
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
      data-testid="watch-context-menu"
      style={{
        position: 'fixed',
        top: menu.y,
        left: menu.x,
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

interface MenuItemProps {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

const MenuItem = ({ disabled = false, label, onSelect }: MenuItemProps): ReactElement => (
  <button
    type="button"
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
