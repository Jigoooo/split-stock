import { SafetySwitchPanel } from '@renderer/features/safety-switch';
import { CredentialsForm } from '@renderer/features/save-credentials';
import { AccountSelector } from '@renderer/features/switch-account';
import { WatchGlobalToggle } from '@renderer/features/watch-global-toggle';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, TableGrid } from '@renderer/shared/ui';
import { dialog } from '@renderer/shared/ui/dialog';
import { Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';

const ENV_LABEL = { MOCK: '모의(MOCK)', PROD: '실전(PROD)' } as const;

/**
 * 설정 → 계좌/보안 탭의 통합 컨테이너.
 *
 * 헤더(account-bar)와 동시에 사용되는 기능들 — 헤더는 "빠른 운용 접근",
 * 이 패널은 "관리/이력 + 위험 액션"을 담당. 모두 동일 store/tRPC 를 통해 자동 동기화.
 *
 * 섹션 순서(위 → 아래):
 *  1. 자격증명 추가 (dialog 로 분리)
 *  2. 자격증명 목록 / 삭제
 *  3. 계좌 전환
 *  4. 자동 감시 글로벌 토글
 *  5. 안전 스위치 (주문 차단)
 *
 * 환경 전환(PROD/MOCK)은 헤더의 SwitchEnvDialog 로 일원화한다 — 같은 환경에 다중 계정이 있을
 * 때 어느 계정으로 전환할지 모호해지는 문제 때문에 설정 탭에서는 노출하지 않는다.
 */
export const CredentialsSettingsPanel = (): ReactElement => {
  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <div className="muted" style={{ fontSize: '0.85em' }}>
        헤더의 계좌·환경·자동감시·안전 스위치는 이 탭과 실시간 동기화됩니다. 일상적 변경은 헤더에서,
        관리·삭제는 이 탭에서 진행하세요. 환경(MOCK/PROD) 전환은 헤더의 환경 배지에서만 가능합니다.
      </div>

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

      <SafetySwitchPanel />
    </div>
  );
};

/**
 * 자격증명 추가 — 모달 다이얼로그로 분리.
 * 폼이 길어 시선 분산을 막고, 다른 섹션과 격리하기 위해 inline expand 가 아닌 modal 패턴 사용.
 */
function CredentialsAddSection(): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div className="panel">
      <div
        className="panel__title"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span>자격증명 추가</span>
        <Button variant="primary" onClick={() => setOpen(true)} dense>
          추가하기
        </Button>
      </div>
      <div className="panel__body muted" style={{ fontSize: '0.85em' }}>
        새 환경(MOCK/PROD)의 App Key / Secret 을 추가합니다. 추가 후 해당 환경으로 자동 전환됩니다.
      </div>

      {open ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="자격증명 추가">
          <div className="modal panel" style={{ maxWidth: '48rem', width: '90vw' }}>
            <div
              className="panel__title"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <span>자격증명 추가</span>
              <Button onClick={() => setOpen(false)} dense aria-label="닫기">
                닫기
              </Button>
            </div>
            <div className="panel__body">
              <CredentialsForm onSaved={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 저장된 자격증명 목록 + 환경별 / 전체 삭제.
 * (기존 CredentialsSettingsPanel 의 본문을 분리한 sub-component.)
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
              <TableGrid.Cell width={108}>작업</TableGrid.Cell>
            </TableGrid.Header>
            <TableGrid.Body>
              {entries.map((e) => (
                <TableGrid.Row key={e.env}>
                  <TableGrid.Cell width={140}>
                    <span className={`chip ${e.env === 'PROD' ? 'chip--down' : ''}`}>
                      {ENV_LABEL[e.env]}
                    </span>
                  </TableGrid.Cell>
                  <TableGrid.Cell flex={1} numeric>
                    {e.accountNo8}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={120}>
                    {currentEnv === e.env ? <span className="chip chip--up">활성</span> : '-'}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={120}>
                    <Button
                      iconLeading={<Trash2 size={14} />}
                      disabled={pending}
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
