import { Button } from '@renderer/shared/ui';
import { Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';

export interface AccountRow {
  id: number;
  env: 'MOCK' | 'PROD';
  accountNo8: string;
  displayName: string | null;
  isActive: boolean;
}

interface Props {
  accounts: AccountRow[];
  switching: boolean;
  deletePending: boolean;
  hideAddAccount: boolean;
  onPick: (id: number) => void;
  onDelete: (row: AccountRow) => void;
  onAddAccount: () => void;
}

/**
 * 계좌 셀렉터 드롭다운 listbox.
 * - 각 계좌 한 줄: 환경 dot + 라벨 + (현재) 표시 + 휴지통.
 * - 하단: "+ 계좌 추가" 버튼 (hideAddAccount=true 면 숨김).
 */
export const AccountSelectorList = ({
  accounts,
  switching,
  deletePending,
  hideAddAccount,
  onPick,
  onDelete,
  onAddAccount,
}: Props): ReactElement => {
  return (
    <div
      role="listbox"
      aria-label="계좌 목록"
      className="panel"
      style={{
        position: 'absolute',
        top: 'calc(100% + 0.4rem)',
        left: 0,
        zIndex: 50,
        minWidth: '20rem',
        padding: '0.4rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.25)',
      }}
    >
      {accounts.map((a) => (
        <div
          key={a.id}
          className="account-selector__item"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.3rem 0.35rem 0.3rem 0.6rem',
            borderRadius: 4,
          }}
        >
          <button
            type="button"
            onClick={() => onPick(a.id)}
            disabled={switching || a.isActive}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.15rem 0',
              background: 'transparent',
              border: 'none',
              cursor: a.isActive ? 'default' : 'pointer',
              textAlign: 'left',
              font: 'inherit',
              color: 'inherit',
              fontWeight: a.isActive ? 600 : 400,
            }}
          >
            <EnvDot env={a.env} />
            <span>{formatAccountLabel(a)}</span>
            {a.isActive ? (
              <span className="muted" style={{ fontSize: '1rem' }}>
                (현재)
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => onDelete(a)}
            disabled={deletePending}
            aria-label={`${formatAccountLabel(a)} 계좌 삭제`}
            title="계좌 삭제"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.3rem',
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              color: 'var(--fg-2, #888)',
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {hideAddAccount ? null : (
        <>
          <div aria-hidden style={{ height: 1, background: 'var(--border)', margin: '0.3rem 0' }} />
          <Button type="button" onClick={onAddAccount} dense variant="primary">
            + 계좌 추가
          </Button>
        </>
      )}
    </div>
  );
};

export function formatAccountLabel(a: AccountRow): string {
  const tail = a.accountNo8.slice(-4);
  const name = a.displayName?.trim();
  return name && name.length > 0 ? `${name} · ${a.env} ${tail}` : `${a.env} · ${tail}`;
}

export const EnvDot = ({ env }: { env: 'MOCK' | 'PROD' }): ReactElement => (
  <span
    aria-hidden
    style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: env === 'PROD' ? 'var(--danger, #d4453a)' : 'var(--accent, #5b8def)',
    }}
  />
);
