import { EditLotsModeToggle } from '@renderer/features/edit-lots-manual';
import { ClipboardCopy } from 'lucide-react';
import type { ReactElement } from 'react';

interface LotsLogToolbarProps {
  accountId: number | null;
  editBusy: boolean;
  editMode: boolean;
  masterSafetyOn: boolean;
  onCopyAll: () => void;
  onEnterMode: () => Promise<void>;
  onExitMode: () => void;
  search: string;
  setSearch: (value: string) => void;
  snapshotsCount: number;
}

export const LotsLogToolbar = ({
  accountId,
  editBusy,
  editMode,
  masterSafetyOn,
  onCopyAll,
  onEnterMode,
  onExitMode,
  search,
  setSearch,
  snapshotsCount,
}: LotsLogToolbarProps): ReactElement => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.6rem',
      padding: '0.4rem 0.8rem',
      borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
      flexWrap: 'wrap',
    }}
  >
    <input
      type="text"
      value={search}
      onChange={(event) => setSearch(event.target.value)}
      placeholder="종목코드/종목명 검색"
      style={{
        fontSize: '1.1rem',
        padding: '0.2rem 0.5rem',
        border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
        borderRadius: 3,
        minWidth: '12rem',
      }}
    />
    <span className="muted" style={{ fontSize: '1.05rem' }}>
      {snapshotsCount}종목
    </span>
    <button
      type="button"
      onClick={onCopyAll}
      title="전체 클립보드 복사"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '0.25rem 0.6rem',
        fontSize: '1.1rem',
        cursor: 'pointer',
        border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
        borderRadius: 3,
        background: 'transparent',
        color: 'var(--hts-text, inherit)',
      }}
    >
      <ClipboardCopy size={13} />
      전체 복사
    </button>
    <div style={{ marginLeft: 'auto' }}>
      <EditLotsModeToggle
        accountId={accountId}
        masterSafetyOn={masterSafetyOn}
        active={editMode}
        onEnter={onEnterMode}
        onExit={onExitMode}
        busy={editBusy}
      />
    </div>
  </div>
);
