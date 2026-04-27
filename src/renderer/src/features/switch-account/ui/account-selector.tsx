import { trpc } from '@renderer/shared/api/trpc';
import { Button, TextInput } from '@renderer/shared/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSwitchAccount } from '../model/use-switch-account';
import {
  type AccountRow,
  AccountSelectorList,
  EnvDot,
  formatAccountLabel,
} from './account-selector-list';

export interface AccountSelectorProps {
  /**
   * 드롭다운 하단의 "+ 계좌 추가" 버튼 숨김 옵션.
   * 설정 탭에서는 헤더의 진입점만 사용하도록 통일하기 위해 true 로 사용한다.
   */
  hideAddAccount?: boolean;
}

/**
 * 헤더용 계좌 셀렉터 — 활성 계좌를 칩으로 보여주고, 클릭 시 드롭다운에서
 *   - 다른 계좌로 전환 (한 줄 클릭)
 *   - "+ 계좌 추가" 버튼으로 신규 등록 다이얼로그 오픈 (hideAddAccount 가 false 일 때)
 *
 * 활성 계좌 칩에는 env 배지 + 계좌번호 마지막 4자리(혹은 displayName)를 표시.
 * 전환 mutation 진행 중이면 셀렉터 잠금. 드롭다운 listbox 렌더는
 * AccountSelectorList 로 위임 — 본 파일은 query/mutation/popout 윈도우 통신을 담당.
 */
export const AccountSelector = ({
  hideAddAccount = false,
}: AccountSelectorProps = {}): ReactElement | null => {
  const accountsQ = trpc.account.listAccounts.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const { switchAccount, isPending: switching, error: switchError } = useSwitchAccount();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const deleteMutation = trpc.account.delete.useMutation({
    // fire-and-forget: await 하면 모든 query refetch 가 끝날 때까지 deleteMutation.isPending
    // 으로 휴지통 아이콘이 길게 disable 됨.
    onSuccess: (data, variables) => {
      void qc.invalidateQueries();
      window.appShell?.broadcastAccountChanged?.(variables.accountId);
      toast.success(data.loggedOut ? '계좌 삭제 — 로그아웃되었습니다' : '계좌가 삭제되었습니다');
    },
    onError: (err) => {
      toast.error(`삭제 실패: ${err.message}`);
    },
  });

  const renameMutation = trpc.account.rename.useMutation({
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries();
      window.appShell?.broadcastAccountChanged?.(variables.accountId);
      toast.success('별칭이 변경되었습니다');
    },
    onError: (err) => {
      toast.error(`별칭 변경 실패: ${err.message}`);
    },
  });

  const [renameTarget, setRenameTarget] = useState<AccountRow | null>(null);

  const onAddAccount = (): void => {
    setOpen(false);
    void window.appShell?.openPopout('add-account');
  };

  // 팝아웃의 tRPC client 와 메인 창 client 는 별도 인스턴스 → invalidate 전파 안 됨.
  // add-account 팝아웃이 `broadcastAccountChanged` 로 성공을 통지하면 메인이 갱신 + 토스트.
  useEffect(() => {
    const shell = window.appShell;
    if (!shell) return;
    return shell.onAccountChanged(() => {
      void qc.invalidateQueries();
      toast.success('계좌가 추가되었습니다');
    });
  }, [qc]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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

  const onPick = async (id: number): Promise<void> => {
    setOpen(false);
    if (active?.id === id) return;
    try {
      await switchAccount(id);
    } catch {
      // mutation error 는 hook 의 error 로 노출됨.
    }
  };

  const onDelete = (row: AccountRow): void => {
    const msg = row.isActive
      ? all.length === 1
        ? `${formatAccountLabel(row)}\n\n유일한 계좌입니다. 삭제하면 자동 로그아웃되고 자격증명도 제거됩니다. 계속할까요?`
        : `${formatAccountLabel(row)}\n\n활성 계좌입니다. 삭제 시 다른 계좌로 자동 전환됩니다. 계속할까요?`
      : `${formatAccountLabel(row)}\n\n이 계좌와 자격증명을 삭제할까요?`;
    if (!window.confirm(msg)) return;
    deleteMutation.mutate({ accountId: row.id });
  };

  const label = active ? formatAccountLabel(active) : '계좌 미선택';

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', gap: '0.4rem' }}>
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
        <AccountSelectorList
          accounts={all}
          switching={switching}
          deletePending={deleteMutation.isPending}
          renamePending={renameMutation.isPending}
          hideAddAccount={hideAddAccount}
          onPick={(id) => {
            void onPick(id);
          }}
          onDelete={onDelete}
          onRename={(row) => {
            setOpen(false);
            setRenameTarget(row);
          }}
          onAddAccount={onAddAccount}
        />
      ) : null}

      {switchError ? (
        <span className="chip chip--down" role="alert">
          {switchError.message}
        </span>
      ) : null}

      {renameTarget ? (
        <RenameAccountModal
          row={renameTarget}
          pending={renameMutation.isPending}
          onConfirm={(displayName) => {
            renameMutation.mutate(
              {
                accountId: renameTarget.id,
                displayName: displayName.length > 0 ? displayName : null,
              },
              { onSettled: () => setRenameTarget(null) },
            );
          }}
          onCancel={() => setRenameTarget(null)}
        />
      ) : null}
    </div>
  );
};

const RenameAccountModal = ({
  row,
  pending,
  onConfirm,
  onCancel,
}: {
  row: AccountRow;
  pending: boolean;
  onConfirm: (displayName: string) => void;
  onCancel: () => void;
}): ReactElement => {
  const [name, setName] = useState(row.displayName ?? '');
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="계좌 별칭 편집">
      <div className="modal panel">
        <div className="panel__title">계좌 별칭 편집</div>
        <div className="panel__body" style={{ display: 'grid', gap: '0.6rem' }}>
          <div className="muted">{formatAccountLabel(row)}</div>
          <label htmlFor="rename-display-name" style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted">별칭 (비우면 자동 라벨)</span>
            <TextInput
              id="rename-display-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 20))}
              placeholder="예: 메인 KIS 실전"
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              dense
            />
          </label>
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}
        >
          <Button onClick={onCancel} disabled={pending} dense>
            취소
          </Button>
          <Button onClick={() => onConfirm(name.trim())} disabled={pending} variant="primary" dense>
            {pending ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </div>
  );
};
