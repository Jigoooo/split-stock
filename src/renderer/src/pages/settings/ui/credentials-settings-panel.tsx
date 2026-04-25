import { SafetySwitchHeader } from '@renderer/features/safety-switch';
import { useSwitchAccount } from '@renderer/features/switch-account';
import { WatchGlobalToggle } from '@renderer/features/watch-global-toggle';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, TableGrid } from '@renderer/shared/ui';
import { dialog } from '@renderer/shared/ui/dialog';
import { Check, LogIn, Trash2 } from 'lucide-react';
import type { CSSProperties, ReactElement } from 'react';
import { toast } from 'sonner';

const ENV_LABEL = { MOCK: '모의(MOCK)', PROD: '실전(PROD)' } as const;

/**
 * 설정 → 계좌/보안 탭의 통합 컨테이너.
 *
 * 헤더(account-bar)와 동일한 컴포넌트를 임베드하여 시각적 일관성을 보장한다.
 * - 자격증명 추가는 헤더 셀렉트와 동일한 'add-account' 팝아웃을 연다.
 * - 자동감시/주문 토글은 헤더형 컴포넌트를 그대로 재사용.
 * - 환경(MOCK/PROD) 전환은 헤더 환경 배지에서만 가능.
 */
export const CredentialsSettingsPanel = (): ReactElement => {
  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <CredentialsAddSection />
      <CredentialsListSection />

      <div className="panel">
        <div className="panel__title">자동 감시 (전역)</div>
        <div className="panel__body">
          <WatchGlobalToggle />
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">주문 허용 상태</div>
        <div className="panel__body">
          <SafetySwitchHeader />
        </div>
      </div>
    </div>
  );
};

/**
 * 자격증명 추가 — 헤더 계좌 셀렉트의 "추가하기"와 동일한 팝아웃 윈도우를 연다.
 * 두 진입점이 같은 자식 창을 공유하도록 통일.
 */
function CredentialsAddSection(): ReactElement {
  const handleOpen = (): void => {
    void window.appShell?.openPopout('add-account');
  };

  return (
    <div className="panel">
      <div
        className="panel__title"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span>자격증명 추가</span>
        <Button variant="primary" onClick={handleOpen} dense>
          추가하기
        </Button>
      </div>
      <div className="panel__body muted" style={{ fontSize: '0.85em' }}>
        새 환경(MOCK/PROD)의 App Key / Secret 을 추가합니다. 추가 후 해당 환경으로 자동 전환됩니다.
      </div>
    </div>
  );
}

/**
 * 저장된 자격증명 목록 + 환경별 / 전체 삭제.
 */
function CredentialsListSection(): ReactElement {
  const utils = trpc.useUtils();
  const envQuery = trpc.auth.getEnv.useQuery();
  const stored = trpc.auth.listStored.useQuery();
  const { switchAccount, isPending: switching } = useSwitchAccount();
  const clearCredentials = trpc.auth.clearCredentials.useMutation({
    // fire-and-forget: invalidate refetch 를 await 하면 휴지통 버튼이 길게 disable 됨.
    onSuccess: (_data, variables) => {
      void utils.auth.listStored.invalidate();
      void utils.auth.getEnv.invalidate();
      toast.success(`${ENV_LABEL[variables.env]} 자격증명이 삭제되었습니다`);
    },
    onError: (err) => {
      toast.error(`자격증명 삭제 실패: ${err.message}`);
    },
  });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      void utils.invalidate();
      toast.success('로그아웃되었습니다');
    },
    onError: (err) => {
      toast.error(`로그아웃 실패: ${err.message}`);
    },
  });

  const entries = stored.data?.entries ?? [];
  const currentEnv = envQuery.data?.env ?? null;

  const handleDeleteOne = async (env: 'MOCK' | 'PROD'): Promise<void> => {
    const envName = ENV_LABEL[env];
    const confirmed = await dialog.openAsync({
      type: 'WARNING',
      title: `${envName} 자격증명 삭제`,
      confirmText: '삭제',
      cancelText: '취소',
      isCancelWith: true,
      message: (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div>
            <strong>{envName}</strong> 환경의 저장된 App Key / Secret 을 삭제합니다.
          </div>
          <div className="muted">
            이후 <strong>{envName}</strong> 로그인 시 App Key / Secret 재입력이 필요합니다. KIS
            개발자센터에서 다시 확인해야 할 수 있습니다.
          </div>
          {currentEnv === env ? (
            <div className="muted">현재 활성 환경이므로 자동으로 로그아웃됩니다.</div>
          ) : null}
        </div>
      ),
    });
    if (!confirmed) return;
    if (currentEnv === env) {
      await logout.mutateAsync({ clearStored: true });
    } else {
      await clearCredentials.mutateAsync({ env });
    }
  };

  const handleDeleteAll = async (): Promise<void> => {
    const confirmed = await dialog.openAsync({
      type: 'ERROR',
      title: '모든 자격증명 삭제 + 로그아웃',
      confirmText: '전체 삭제',
      cancelText: '취소',
      isCancelWith: true,
      message: (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div>
            <strong>모든 환경(MOCK + PROD)</strong> 의 저장된 App Key / Secret 을 삭제하고
            로그아웃합니다.
          </div>
          <div className="muted">
            이 작업은 되돌릴 수 없습니다. 이후 재로그인 시 각 환경의 App Key / Secret 재입력이
            필요합니다.
          </div>
        </div>
      ),
    });
    if (!confirmed) return;
    if (currentEnv) {
      await logout.mutateAsync({ clearStored: true });
    }
    const remaining = entries.filter((e) => e.env !== currentEnv);
    for (const e of remaining) {
      await clearCredentials.mutateAsync({ env: e.env });
    }
  };

  const pending = clearCredentials.isPending || logout.isPending || switching;

  const handleSwitch = async (accountId: number): Promise<void> => {
    try {
      await switchAccount(accountId);
    } catch {
      /* hook 내부에서 toast 처리 */
    }
  };

  return (
    <div className="panel">
      <div className="panel__title">저장된 자격증명</div>
      <div className="panel__body" style={{ display: 'grid', gap: '0.8rem' }}>
        <div className="muted" style={{ fontSize: '0.85em' }}>
          환경별로 저장된 KIS App Key / Secret 을 관리합니다. <strong>전환</strong> 으로 활성 환경을
          변경하고, <strong>휴지통</strong> 으로 자격증명을 삭제할 수 있습니다.
        </div>
        {stored.isLoading ? (
          <div className="muted">불러오는 중…</div>
        ) : entries.length === 0 ? (
          <div className="muted">저장된 자격증명이 없습니다.</div>
        ) : (
          <TableGrid.Root
            variant="hts"
            stickyHeader={false}
            overlayScrollbar={false}
            aria-label="저장된 자격증명 목록"
            style={{ height: 'auto', '--hts-row-height': '3.4rem' } as CSSProperties}
          >
            <TableGrid.Header>
              <TableGrid.Cell width={120}>환경</TableGrid.Cell>
              <TableGrid.Cell flex={1}>계좌번호</TableGrid.Cell>
              <TableGrid.Cell width={140}>상태</TableGrid.Cell>
              <TableGrid.Cell width={56} style={{ justifyContent: 'center' }}>
                작업
              </TableGrid.Cell>
            </TableGrid.Header>
            <TableGrid.Body>
              {entries.map((e) => {
                const isActive = currentEnv === e.env;
                return (
                  <TableGrid.Row key={e.env}>
                    <TableGrid.Cell width={120}>
                      <span className={`chip ${e.env === 'PROD' ? 'chip--down' : 'chip--up'}`}>
                        {ENV_LABEL[e.env]}
                      </span>
                    </TableGrid.Cell>
                    <TableGrid.Cell flex={1} numeric>
                      {e.accountNo8}
                    </TableGrid.Cell>
                    <TableGrid.Cell width={140} style={{ justifyContent: 'center' }}>
                      {isActive ? (
                        <span
                          className="chip chip--live"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.3rem',
                            minHeight: '2.8rem',
                            minWidth: '7rem',
                            padding: '0 0.8rem',
                            boxSizing: 'border-box',
                          }}
                        >
                          <Check size={12} aria-hidden />
                          현재 활성
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          dense
                          iconLeading={<LogIn size={13} />}
                          disabled={pending}
                          aria-label={`${ENV_LABEL[e.env]} 환경으로 전환`}
                          onClick={() => {
                            void handleSwitch(e.accountId);
                          }}
                          style={{ minWidth: '7rem' }}
                        >
                          전환
                        </Button>
                      )}
                    </TableGrid.Cell>
                    <TableGrid.Cell width={56} style={{ justifyContent: 'center' }}>
                      <Button
                        variant="ghost-danger"
                        iconLeading={<Trash2 size={14} />}
                        iconOnly
                        dense
                        disabled={pending}
                        aria-label={`${ENV_LABEL[e.env]} 자격증명 삭제`}
                        title="삭제"
                        onClick={() => {
                          void handleDeleteOne(e.env);
                        }}
                      >
                        삭제
                      </Button>
                    </TableGrid.Cell>
                  </TableGrid.Row>
                );
              })}
            </TableGrid.Body>
          </TableGrid.Root>
        )}
        {entries.length > 0 ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="danger"
              dense
              disabled={pending}
              onClick={() => {
                void handleDeleteAll();
              }}
            >
              모든 자격증명 삭제 + 로그아웃
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
