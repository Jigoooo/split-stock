import { trpc } from '@renderer/shared/api/trpc';
import { LOADING_MESSAGES } from '@renderer/shared/lib/loading-messages';
import { alertDialog, Button, TextInput } from '@renderer/shared/ui';
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

function applyOptimisticOrder(accounts: AccountRow[], orderedIds: number[] | null): AccountRow[] {
  if (!orderedIds) return accounts;

  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const ordered: AccountRow[] = [];
  for (const id of orderedIds) {
    const account = accountsById.get(id);
    if (account) ordered.push(account);
  }
  if (ordered.length === 0) return accounts;

  const orderedIdSet = new Set(orderedIds);
  const remaining = accounts.filter((account) => !orderedIdSet.has(account.id));
  return [...ordered, ...remaining];
}

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
  const storedQ = trpc.auth.listStored.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const { switchAccount, isPending: switching, error: switchError } = useSwitchAccount();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 삭제 다이얼로그가 닫힐 때 포커스를 되돌릴 원래 트리거(휴지통 버튼) 보관 — 키보드 사용자 위치 복구.
  const lastDeleteTriggerRef = useRef<HTMLElement | null>(null);
  // 스크린리더용 aria-live 영역 메시지 — 삭제 결과/순서변경 등 비동기 결과 공지.
  const [liveMessage, setLiveMessage] = useState<string>('');
  const [optimisticOrderedIds, setOptimisticOrderedIds] = useState<number[] | null>(null);

  const deleteMutation = trpc.account.delete.useMutation({
    // fire-and-forget: await 하면 모든 query refetch 가 끝날 때까지 deleteMutation.isPending
    // 으로 휴지통 아이콘이 길게 disable 됨.
    onSuccess: (data, variables) => {
      void qc.invalidateQueries();
      window.appShell?.broadcastAccountChanged?.(variables.accountId);
      const msg = data.loggedOut ? '계좌 삭제 — 로그아웃되었습니다' : '계좌가 삭제되었습니다';
      toast.success(msg);
      setLiveMessage(msg);
      // 삭제된 행의 휴지통 버튼은 이미 사라졌으므로 셀렉터 트리거로 포커스 복구.
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
        lastDeleteTriggerRef.current = null;
      });
    },
    onError: (err) => {
      toast.error(`삭제 실패: ${err.message}`);
      setLiveMessage(`삭제 실패: ${err.message}`);
      // 실패 시에는 원래 휴지통 버튼이 살아있으므로 그쪽으로 복구.
      requestAnimationFrame(() => {
        const target = lastDeleteTriggerRef.current;
        if (target && document.contains(target)) target.focus();
        else triggerRef.current?.focus();
        lastDeleteTriggerRef.current = null;
      });
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

  const reorderMutation = trpc.account.reorder.useMutation({
    onSuccess: () => {
      void qc
        .invalidateQueries()
        .catch(() => undefined)
        .finally(() => setOptimisticOrderedIds(null));
      // 시각 피드백은 목록 순서 변화로 충분하므로, 성공 toast 는 띄우지 않고 스크린리더 공지만 유지.
      setLiveMessage('계좌 순서가 변경되었습니다');
    },
    onError: (err) => {
      setOptimisticOrderedIds(null);
      toast.error(`순서 변경 실패: ${err.message}`);
      setLiveMessage(`순서 변경 실패: ${err.message}`);
    },
  });

  const [renameTarget, setRenameTarget] = useState<AccountRow | null>(null);

  const onAddAccount = (): void => {
    setOpen(false);
    void window.appShell?.openPopout('add-account');
  };

  // 팝아웃의 tRPC client 와 메인 창 client 는 별도 인스턴스 → invalidate 전파 안 됨.
  // add-account 팝아웃이 `broadcastAccountChanged` 로 성공을 통지하면 메인이 갱신 + 토스트.
  // meta.envSwitchedTo 가 PROD 면 첫 계좌 자동 활성화로 메인 환경이 실전으로 전환됐음을 강조 toast.
  useEffect(() => {
    const shell = window.appShell;
    if (!shell) return;
    return shell.onAccountChanged((_accountId, meta) => {
      void qc.invalidateQueries();
      if (meta?.envSwitchedTo === 'PROD') {
        toast.warning('⚠ 실전(PROD) 환경으로 전환되었습니다 — 모든 주문은 실제로 체결됩니다.', {
          duration: 8000,
        });
      } else if (meta?.envSwitchedTo === 'MOCK') {
        toast.info('모의투자(MOCK) 환경으로 전환되었습니다.');
      } else {
        toast.success('계좌가 추가되었습니다');
      }
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
    return <span className="muted">{LOADING_MESSAGES.ACCOUNTS_LOADING}</span>;
  }
  if (accountsQ.error || !accountsQ.data) {
    return <span className="chip chip--down">계좌 조회 실패</span>;
  }

  const allById = new Map<number, AccountRow>();
  for (const a of accountsQ.data.accounts) {
    allById.set(a.id, {
      id: a.id,
      env: a.env,
      broker: a.broker ?? 'KIS',
      accountNo8: a.accountNo8,
      accountProdCd: a.accountProdCd ?? null,
      displayName: a.displayName,
      isActive: a.isActive,
    });
  }
  // 복원/마이그레이션 직후 accounts 조회가 비어도 settings 의 저장된 자격증명은 보일 수 있다.
  // 이때 헤더 셀렉터에서도 동일한 항목을 fallback 으로 보여줘 "설정에는 있는데 헤더에는 없음"을 막는다.
  for (const entry of storedQ.data?.entries ?? []) {
    if (allById.has(entry.accountId)) continue;
    allById.set(entry.accountId, {
      id: entry.accountId,
      env: entry.env,
      broker: entry.broker,
      accountNo8: entry.accountNo8,
      accountProdCd: null,
      displayName: null,
      isActive: accountsQ.data.activeAccountId === entry.accountId,
    });
  }
  const all = [...allById.values()];
  const activeAccountId = accountsQ.data.activeAccountId;
  const hasExplicitActive = all.some((a) => a.isActive);
  const normalizedAll: AccountRow[] = all.map((a) => ({
    id: a.id,
    env: a.env,
    broker: a.broker,
    accountNo8: a.accountNo8,
    accountProdCd: a.accountProdCd ?? null,
    displayName: a.displayName,
    isActive: a.isActive || (!hasExplicitActive && activeAccountId === a.id),
  }));
  const visibleAccounts = applyOptimisticOrder(normalizedAll, optimisticOrderedIds);
  const active = visibleAccounts.find((a) => a.isActive) ?? null;

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
    const message = row.isActive
      ? all.length === 1
        ? `${formatAccountLabel(row)} — 유일한 계좌입니다. 삭제하면 자동 로그아웃되고 자격증명도 제거됩니다. 계속할까요?`
        : `${formatAccountLabel(row)} — 활성 계좌입니다. 삭제 시 다른 계좌로 자동 전환됩니다. 계속할까요?`
      : `${formatAccountLabel(row)} — 이 계좌와 자격증명을 삭제할까요?`;
    // 다이얼로그 진입 시점의 활성 element 를 보관 → 취소/실패 시 그 위치로 포커스 복귀.
    const activeAtOpen =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    lastDeleteTriggerRef.current = activeAtOpen;
    void (async () => {
      const confirmed = await alertDialog.confirm({
        title: '계좌 삭제',
        message,
        confirmText: '삭제',
        cancelText: '취소',
      });
      if (!confirmed) {
        // 취소 시 원래 휴지통 버튼으로 포커스 복구 (키보드 사용자 흐름 보존).
        requestAnimationFrame(() => {
          const target = lastDeleteTriggerRef.current;
          if (target && document.contains(target)) target.focus();
          lastDeleteTriggerRef.current = null;
        });
        return;
      }
      deleteMutation.mutate({ accountId: row.id });
    })();
  };

  const onReorder = (orderedIds: number[]): void => {
    setOptimisticOrderedIds(orderedIds);
    reorderMutation.mutate({ orderedIds });
  };

  const label = active ? formatAccountLabel(active) : '계좌 미선택';

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', gap: '0.4rem' }}>
      {/* 비동기 결과(삭제 등) 공지 — 시각 사용자에게는 보이지 않고 스크린리더에만 전달. */}
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {liveMessage}
      </span>
      <Button
        ref={triggerRef}
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
          accounts={visibleAccounts}
          switching={switching}
          deletePending={deleteMutation.isPending}
          renamePending={renameMutation.isPending}
          reorderPending={reorderMutation.isPending}
          hideAddAccount={hideAddAccount}
          onPick={(id) => {
            void onPick(id);
          }}
          onDelete={onDelete}
          onRename={(row) => {
            setOpen(false);
            setRenameTarget(row);
          }}
          onReorder={onReorder}
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
          <Button
            onClick={() => onConfirm(name.trim())}
            loading={pending}
            loadingText="저장 중…"
            variant="primary"
            dense
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  );
};
