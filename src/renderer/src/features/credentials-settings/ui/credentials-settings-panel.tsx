import { SafetySwitchHeader } from '@renderer/features/safety-switch';
import { AccountSelector } from '@renderer/features/switch-account';
import { WatchGlobalToggle } from '@renderer/features/watch-global-toggle';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, TableGrid } from '@renderer/shared/ui';
import { dialog } from '@renderer/shared/ui/dialog';
import { Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';
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
        <div className="panel__title">계좌 전환</div>
        <div className="panel__body">
          <AccountSelector hideAddAccount />
        </div>
      </div>

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
  const clearCredentials = trpc.auth.clearCredentials.useMutation({
    onSuccess: async (_data, variables) => {
      await Promise.all([utils.auth.listStored.invalidate(), utils.auth.getEnv.invalidate()]);
      toast.success(`${ENV_LABEL[variables.env]} 자격증명이 삭제되었습니다`);
    },
    onError: (err) => {
      toast.error(`자격증명 삭제 실패: ${err.message}`);
    },
  });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
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

  const pending = clearCredentials.isPending || logout.isPending;

  return (
    <div className="panel">
      <div className="panel__title">저장된 자격증명</div>
      <div className="panel__body" style={{ display: 'grid', gap: '0.8rem' }}>
        <div className="muted" style={{ fontSize: '0.85em' }}>
          저장된 KIS App Key / Secret 을 환경별로 관리합니다. 삭제 후에는 재로그인 시 다시 입력해야
          합니다.
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
            style={{ height: 'auto' }}
          >
            <TableGrid.Header>
              <TableGrid.Cell width={140}>환경</TableGrid.Cell>
              <TableGrid.Cell flex={1}>계좌번호</TableGrid.Cell>
              <TableGrid.Cell width={120}>현재 활성</TableGrid.Cell>
              <TableGrid.Cell width={64}>작업</TableGrid.Cell>
            </TableGrid.Header>
            <TableGrid.Body>
              {entries.map((e) => (
                <TableGrid.Row key={e.env} style={{ minHeight: '2.8rem' }}>
                  <TableGrid.Cell width={140}>
                    <span className={`chip ${e.env === 'PROD' ? 'chip--down' : 'chip--up'}`}>
                      {ENV_LABEL[e.env]}
                    </span>
                  </TableGrid.Cell>
                  <TableGrid.Cell flex={1} numeric>
                    {e.accountNo8}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={120}>
                    {currentEnv === e.env ? <span className="chip chip--up">활성</span> : '-'}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={64}>
                    <Button
                      iconLeading={<Trash2 size={14} />}
                      iconOnly
                      dense
                      disabled={pending}
                      aria-label={`${ENV_LABEL[e.env]} 자격증명 삭제`}
                      onClick={() => {
                        void handleDeleteOne(e.env);
                      }}
                    >
                      삭제
                    </Button>
                  </TableGrid.Cell>
                </TableGrid.Row>
              ))}
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
