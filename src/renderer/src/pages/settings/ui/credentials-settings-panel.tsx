import { SafetySwitchHeader } from '@renderer/features/safety-switch';
import { useSwitchAccount } from '@renderer/features/switch-account';
import { WatchGlobalToggle } from '@renderer/features/watch-global-toggle';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, TableGrid, TextInput } from '@renderer/shared/ui';
import { dialog } from '@renderer/shared/ui/dialog';
import type { AppEnv, BrokerId } from '@shared/contracts';
import { Check, LogIn, Trash2 } from 'lucide-react';
import { type CSSProperties, type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';

const ENV_LABEL: Record<AppEnv, string> = { MOCK: '모의(MOCK)', PROD: '실전(PROD)' };
const BROKER_LABEL: Record<BrokerId, string> = { KIS: '한국투자증권', KIWOOM: '키움증권' };

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
 * 위험한 삭제 작업의 phrase-typed 확인 모달.
 *
 * 표준 dialog 의 단순 confirm 보다 한 단계 강한 게이트:
 *   - 사용자가 정확한 문구("삭제")를 타이핑해야 confirm 활성화.
 *   - 우발적 클릭/Enter 연타로 인한 자격증명 손실 방지.
 *
 * ProdConfirmModal 과 동일한 골격을 사용하되, 본 케이스는 settings-page
 * 단일 진입점 전용 → 공용 컴포넌트로 끌어올리지 않고 inline 유지.
 */
const PHRASE = '삭제';
function PhraseDeleteModal({
  open,
  pending,
  title,
  message,
  confirmText,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  title: string;
  message: ReactNode;
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement | null {
  const [value, setValue] = useState('');
  // 모달이 열릴 때마다 입력 초기화 — 이전 phrase 가 잔존해 자동 confirm 되는 것 방지.
  useEffect(() => {
    if (!open) setValue('');
  }, [open]);
  if (!open) return null;
  const matched = value.trim() === PHRASE;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal panel">
        <div className="panel__title">{title}</div>
        <div className="panel__body" style={{ display: 'grid', gap: '1rem' }}>
          {message}
          <label htmlFor="phrase-delete-input" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>
              계속 진행하려면 <code>{PHRASE}</code> 라고 정확히 입력하세요:
            </span>
            <TextInput
              id="phrase-delete-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={PHRASE}
              autoComplete="off"
              spellCheck={false}
              dense
              autoFocus
            />
          </label>
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}
        >
          <Button onClick={onCancel} disabled={pending} dense>
            취소
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!matched}
            loading={pending}
            loadingText="삭제 중…"
            variant="danger"
            dense
          >
            {confirmText}
          </Button>
        </div>
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

  // PROD/전체 삭제 등 위험 작업은 phrase 모달 게이트로 보호.
  // MOCK 단건 삭제는 표준 confirm 만으로 충분.
  const [phraseGate, setPhraseGate] = useState<
    { kind: 'one'; env: AppEnv; broker: BrokerId } | { kind: 'all' } | null
  >(null);

  const performDeleteOne = async (env: AppEnv, broker: BrokerId): Promise<void> => {
    if (currentEnv === env && broker === 'KIS') {
      await logout.mutateAsync({ clearStored: true });
    } else {
      await clearCredentials.mutateAsync({ env, broker });
    }
  };

  const handleDeleteOne = async (env: AppEnv, broker: BrokerId = 'KIS'): Promise<void> => {
    // PROD 또는 활성 KIS 자격증명 삭제는 phrase 게이트 강제 — 우발적 손실 방지.
    if (env === 'PROD' || (currentEnv === env && broker === 'KIS')) {
      setPhraseGate({ kind: 'one', env, broker });
      return;
    }
    const envName = ENV_LABEL[env];
    const brokerName = BROKER_LABEL[broker];
    const confirmed = await dialog.openAsync({
      type: 'WARNING',
      title: `${brokerName} ${envName} 자격증명 삭제`,
      confirmText: '삭제',
      cancelText: '취소',
      isCancelWith: true,
      message: (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div>
            <strong>
              {brokerName} {envName}
            </strong>{' '}
            환경의 저장된 App Key / Secret 을 삭제합니다.
          </div>
          <div className="muted">
            이후 재로그인 시 App Key / Secret 재입력이 필요합니다. {brokerName} 개발자센터에서 다시
            확인해야 할 수 있습니다.
          </div>
        </div>
      ),
    });
    if (!confirmed) return;
    await performDeleteOne(env, broker);
  };

  const performDeleteAll = async (): Promise<void> => {
    if (currentEnv) {
      await logout.mutateAsync({ clearStored: true });
    }
    const remaining = entries.filter((e) => !(e.env === currentEnv && e.broker === 'KIS'));
    for (const e of remaining) {
      await clearCredentials.mutateAsync({ env: e.env, broker: e.broker });
    }
  };

  const handleDeleteAll = (): void => {
    setPhraseGate({ kind: 'all' });
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
              <TableGrid.Cell width={120}>증권사</TableGrid.Cell>
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
                  <TableGrid.Row key={`${e.broker}-${e.env}`}>
                    <TableGrid.Cell width={120}>
                      <span
                        className="chip"
                        style={{
                          background: e.broker === 'KIWOOM' ? '#ffe6e8' : '#fff7d6',
                          color: e.broker === 'KIWOOM' ? '#c41e2c' : '#7c5e00',
                          fontWeight: 600,
                        }}
                      >
                        {BROKER_LABEL[e.broker]}
                      </span>
                    </TableGrid.Cell>
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
                          void handleDeleteOne(e.env, e.broker);
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
            <Button variant="danger" dense disabled={pending} onClick={handleDeleteAll}>
              모든 자격증명 삭제 + 로그아웃
            </Button>
          </div>
        ) : null}
      </div>

      <PhraseDeleteModal
        open={phraseGate !== null}
        pending={pending}
        title={
          phraseGate?.kind === 'all'
            ? '⚠ 모든 자격증명 삭제 + 로그아웃'
            : phraseGate?.kind === 'one'
              ? `⚠ ${BROKER_LABEL[phraseGate.broker]} ${ENV_LABEL[phraseGate.env]} 자격증명 삭제`
              : ''
        }
        confirmText={phraseGate?.kind === 'all' ? '전체 삭제' : '삭제'}
        message={
          phraseGate?.kind === 'all' ? (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <strong>모든 환경(MOCK + PROD)</strong> 의 저장된 App Key / Secret 을 삭제하고
              로그아웃합니다.
              <span className="muted">
                되돌릴 수 없습니다. 이후 재로그인 시 각 환경의 App Key / Secret 재입력이 필요합니다.
              </span>
            </div>
          ) : phraseGate?.kind === 'one' ? (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <strong>
                {BROKER_LABEL[phraseGate.broker]} {ENV_LABEL[phraseGate.env]}
              </strong>{' '}
              환경의 저장된 App Key / Secret 을 삭제합니다.
              <span className="muted">
                이후 재로그인 시 App Key / Secret 재입력이 필요합니다.
                {currentEnv === phraseGate.env && phraseGate.broker === 'KIS'
                  ? ' 현재 활성 환경이므로 자동으로 로그아웃됩니다.'
                  : ''}
              </span>
            </div>
          ) : null
        }
        onCancel={() => setPhraseGate(null)}
        onConfirm={() => {
          if (!phraseGate) return;
          const target = phraseGate;
          setPhraseGate(null);
          if (target.kind === 'all') {
            void performDeleteAll();
          } else {
            void performDeleteOne(target.env, target.broker);
          }
        }}
      />
    </div>
  );
}
