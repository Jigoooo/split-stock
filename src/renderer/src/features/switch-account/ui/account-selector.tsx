import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useSwitchAccount } from '../model/use-switch-account';
import { AddAccountDialog } from './add-account-dialog';

interface AccountRow {
  id: number;
  env: 'MOCK' | 'PROD';
  accountNo8: string;
  displayName: string | null;
  isActive: boolean;
}

/**
 * 헤더용 계좌 셀렉터 — 활성 계좌를 칩으로 보여주고, 클릭 시 드롭다운에서
 *   - 다른 계좌로 전환 (한 줄 클릭)
 *   - "+ 계좌 추가" 버튼으로 신규 등록 다이얼로그 오픈
 *
 * 활성 계좌 칩에는 env 배지 + 계좌번호 마지막 4자리(혹은 displayName)를 표시.
 * 전환 mutation 진행 중이면 셀렉터 잠금.
 */
export const AccountSelector = (): ReactElement | null => {
  const accountsQ = trpc.account.listAccounts.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const { switchAccount, isPending: switching, error: switchError } = useSwitchAccount();
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  if (accountsQ.isPending) {
    return <span className="muted">계좌 로드 중…</span>;
  }
  if (accountsQ.error || !accountsQ.data) {
    return <span className="chip chip--down">계좌 조회 실패</span>;
  }

  const all: AccountRow[] = accountsQ.data.accounts.map((a) => ({
    id: a.id,
    env: a.env,
    accountNo8: a.accountNo8,
    displayName: a.displayName,
    isActive: a.isActive,
  }));
  const active = all.find((a) => a.isActive) ?? null;
  const others = all.filter((a) => !a.isActive);

  const onPick = async (id: number): Promise<void> => {
    setOpen(false);
    if (active?.id === id) return;
    try {
      await switchAccount(id);
    } catch {
      // mutation error 는 hook 의 error 로 노출됨.
    }
  };

  const label = active ? formatAccountLabel(active) : '계좌 미선택';

  return (
    <div style={{ position: 'relative', display: 'inline-flex', gap: '0.4rem' }}>
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        aria-haspopup="listbox"
        aria-expanded={open}
        dense
        title="계좌 전환"
      >
        {active ? <EnvDot env={active.env} /> : null}
        <span style={{ marginLeft: active ? '0.4rem' : 0 }}>{label}</span>
        <span aria-hidden style={{ marginLeft: '0.4rem' }}>
          ▾
        </span>
      </Button>

      {open ? (
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
          {others.length === 0 ? (
            <div className="muted" style={{ padding: '0.4rem 0.6rem' }}>
              등록된 다른 계좌 없음
            </div>
          ) : (
            others.map((a) => (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  void onPick(a.id);
                }}
                disabled={switching}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.45rem 0.6rem',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                  color: 'inherit',
                }}
                className="account-selector__item"
              >
                <EnvDot env={a.env} />
                <span>{formatAccountLabel(a)}</span>
              </button>
            ))
          )}
          <div aria-hidden style={{ height: 1, background: 'var(--border)', margin: '0.3rem 0' }} />
          <Button
            type="button"
            onClick={() => {
              setOpen(false);
              setAddOpen(true);
            }}
            dense
            variant="primary"
          >
            + 계좌 추가
          </Button>
        </div>
      ) : null}

      {switchError ? (
        <span className="chip chip--down" role="alert">
          {switchError.message}
        </span>
      ) : null}

      <AddAccountDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
};

function formatAccountLabel(a: AccountRow): string {
  const tail = a.accountNo8.slice(-4);
  const name = a.displayName?.trim();
  return name && name.length > 0 ? `${name} · ${a.env} ${tail}` : `${a.env} · ${tail}`;
}

const EnvDot = ({ env }: { env: 'MOCK' | 'PROD' }): ReactElement => (
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
