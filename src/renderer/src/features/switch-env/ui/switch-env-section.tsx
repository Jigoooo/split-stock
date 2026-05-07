import { trpc } from '@renderer/shared/api/trpc';
import {
  Button,
  Checkbox,
  PROD_CONFIRM_PHRASE,
  TextInput,
  usePhraseGate,
} from '@renderer/shared/ui';
import type { AppEnv } from '@shared/contracts';
import { type ReactElement, useEffect, useState } from 'react';
import { toast } from 'sonner';

type Env = AppEnv;

/**
 * 설정 패널용 환경 전환 섹션.
 *
 * 헤더의 SwitchEnvDialog와 다른 점:
 * - useAppShell.pendingEnv 공유 상태에 의존하지 않는다 — 패널 자체 local state.
 * - dialog/modal 형태가 아니라 인라인 expand 폼.
 * - PROD 전환 시 phrase + checkbox 2단계 보호는 동일.
 */
export const SwitchEnvSection = (): ReactElement => {
  const utils = trpc.useUtils();
  const envQuery = trpc.auth.getEnv.useQuery();
  const setEnv = trpc.auth.setEnv.useMutation({
    // await 하면 모든 query refetch 가 끝날 때까지 setEnv.isPending=true 가 유지되어
    // 전환 버튼이 길게 disable 됨 → fire-and-forget. 각 useQuery 가 자체 refetch.
    onSuccess: (_data, variables) => {
      void utils.invalidate();
      // PROD 전환은 사고 위험이 크므로 warning 토스트로 강조 + 긴 표시.
      if (variables === 'PROD') {
        toast.warning('⚠ 실전(PROD) 환경으로 전환되었습니다 — 모든 주문은 실제로 체결됩니다.', {
          duration: 8000,
        });
      } else {
        toast.success('모의(MOCK) 환경으로 전환되었습니다.');
      }
      reset();
    },
    onError: (err) => {
      toast.error(`환경 전환 실패: ${err.message}`);
    },
  });

  const logEnvSwitchCancelled = trpc.auth.logEnvSwitchCancelled.useMutation();

  const [target, setTarget] = useState<Env | null>(null);
  const gate = usePhraseGate();
  const { reset: resetGate } = gate;

  const currentEnv = envQuery.data?.env ?? null;

  const reset = (): void => {
    // PROD 전환 시도 취소 시 audit log 기록 (MOCK 취소는 노이즈).
    if (target === 'PROD') {
      logEnvSwitchCancelled.mutate();
    }
    setTarget(null);
    resetGate();
  };

  const startSwitch = (next: Env): void => {
    if (next === currentEnv) return;
    setTarget(next);
    resetGate();
  };

  // target 이 PROD 가 아닐 때 gate state 가 잔존하면 다음 PROD 진입 시 자동 통과 위험.
  useEffect(() => {
    if (target !== 'PROD') resetGate();
  }, [target, resetGate]);

  const isProd = target === 'PROD';
  const canConfirm = target !== null && (isProd ? gate.canConfirm : true);
  const pending = setEnv.isPending;

  const onConfirm = (): void => {
    if (!target || !canConfirm) return;
    setEnv.mutate(target);
  };

  return (
    <div style={{ display: 'grid', gap: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span className="muted">현재 환경:</span>
        {currentEnv ? (
          <span className={`env-badge env-badge--${currentEnv === 'PROD' ? 'prod' : 'mock'}`}>
            {currentEnv === 'PROD' ? '실전(PROD)' : '모의(MOCK)'}
          </span>
        ) : (
          <span className="muted">미설정</span>
        )}
      </div>

      {target === null ? (
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Button
            onClick={() => startSwitch('MOCK')}
            disabled={pending || currentEnv === 'MOCK'}
            dense
          >
            모의(MOCK)로 전환
          </Button>
          <Button
            variant="danger"
            onClick={() => startSwitch('PROD')}
            disabled={pending || currentEnv === 'PROD'}
            dense
          >
            ⚠ 실전(PROD)로 전환
          </Button>
        </div>
      ) : (
        <div
          className="panel"
          style={{
            background: 'var(--surface-2, transparent)',
            border: '1px solid var(--border, currentColor)',
            padding: '0.8rem',
            display: 'grid',
            gap: '0.8rem',
          }}
        >
          {!isProd ? (
            <div>
              <strong>모의(MOCK)</strong> 환경으로 전환합니다. 실제 주문은 발생하지 않습니다.
            </div>
          ) : (
            <>
              <div>
                <strong>⚠ 실전(PROD) 환경으로 전환합니다.</strong>
              </div>
              <div className="muted">
                이후 모든 주문은 실제 계좌로 체결됩니다. 돌이킬 수 없습니다.
              </div>
              <Checkbox
                aria-label="실전 모드 동의"
                checked={gate.ack}
                onChange={(e) => gate.setAck(e.target.checked)}
                label="실전 모드임을 이해했고 계속 진행하는 데 동의합니다."
                dense
              />
              <label htmlFor="switch-env-section-phrase" style={{ display: 'grid', gap: '0.4rem' }}>
                <span>
                  아래에 <code>{PROD_CONFIRM_PHRASE}</code> 이라고 정확히 타이핑하세요:
                </span>
                <TextInput
                  id="switch-env-section-phrase"
                  type="text"
                  value={gate.phrase}
                  onChange={(e) => gate.setPhrase(e.target.value)}
                  placeholder={PROD_CONFIRM_PHRASE}
                  aria-label="실전전환 확인 문구"
                  autoComplete="off"
                  spellCheck={false}
                  dense
                />
              </label>
            </>
          )}

          {setEnv.error ? <span className="chip chip--down">{setEnv.error.message}</span> : null}

          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button onClick={reset} disabled={pending} dense>
              취소
            </Button>
            <Button
              variant={isProd ? 'danger' : 'primary'}
              onClick={onConfirm}
              disabled={!canConfirm}
              loading={pending}
              loadingText="전환 중…"
              dense
            >
              전환 확정
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
