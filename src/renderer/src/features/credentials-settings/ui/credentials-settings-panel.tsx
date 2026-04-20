import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { dialog } from '@renderer/shared/ui/dialog';
import type { ReactElement } from 'react';

const ENV_LABEL = { MOCK: '모의(MOCK)', PROD: '실전(PROD)' } as const;

/**
 * 저장된 KIS App Key / Secret 자격증명을 env 단위로 관리.
 *
 * UX 정책:
 * - 헤더에는 "로그아웃"만 노출 (일상적인 세션 종료).
 * - 자격증명 삭제 = rare + destructive 액션이므로 Settings 에서만 수행.
 * - 각 env 별 개별 삭제 + 전체 삭제(모든 env + 로그아웃) 경로 제공.
 */
export const CredentialsSettingsPanel = (): ReactElement => {
  const utils = trpc.useUtils();
  const envQuery = trpc.auth.getEnv.useQuery();
  const stored = trpc.auth.listStored.useQuery();
  const clearCredentials = trpc.auth.clearCredentials.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.auth.listStored.invalidate(),
        utils.auth.getEnv.invalidate(),
      ]);
    },
  });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
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
    // 활성 env 먼저 logout(clearStored=true) 로 현재 세션 + 해당 env cred 제거,
    // 나머지 env 는 clearCredentials 로 개별 제거.
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
      <div className="panel__title">보안 · 자격증명</div>
      <div className="panel__body" style={{ display: 'grid', gap: '0.8rem' }}>
        <div className="muted" style={{ fontSize: '1.1rem' }}>
          저장된 KIS App Key / Secret 을 환경별로 관리합니다. 삭제 후에는 재로그인 시 다시 입력해야
          합니다.
        </div>
        {stored.isLoading ? (
          <div className="muted">불러오는 중…</div>
        ) : entries.length === 0 ? (
          <div className="muted">저장된 자격증명이 없습니다.</div>
        ) : (
          <table
            className="hts-table"
            aria-label="저장된 자격증명 목록"
            style={{ tableLayout: 'fixed' }}
          >
            <colgroup>
              <col style={{ width: '24%' }} />
              <col />
              <col style={{ width: '20%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>환경</th>
                <th>계좌번호</th>
                <th>현재 활성</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.env}>
                  <td>
                    <span className={`chip ${e.env === 'PROD' ? 'chip--down' : ''}`}>
                      {ENV_LABEL[e.env]}
                    </span>
                  </td>
                  <td className="num">{e.accountNo8}</td>
                  <td>{currentEnv === e.env ? <span className="chip chip--up">활성</span> : '-'}</td>
                  <td>
                    <Button
                      variant="danger"
                      dense
                      disabled={pending}
                      onClick={() => {
                        void handleDeleteOne(e.env);
                      }}
                    >
                      삭제
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
};
