import { useActiveAccountId } from '@renderer/entities/account';
import { useRateGuardSettings } from '@renderer/entities/rate-guard';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, NumberInput, Switch } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

/**
 * 연속매수 방지(rate-guard) 설정 폼.
 * - 활성화 토글
 * - 윈도우 시간(초) 입력
 * - 최대 매수 횟수 입력
 */
export const RateGuard = (): ReactElement => {
  const { accountId } = useActiveAccountId();
  const { isPending, error, settings } = useRateGuardSettings(accountId);
  const utils = trpc.useUtils();
  const updateMutation = trpc.rateGuard.updateSettings.useMutation({
    onSuccess: () => {
      void utils.rateGuard.getSettings.invalidate();
      toast.success('연속매수 방지 설정이 저장되었습니다');
    },
    onError: (err) => {
      toast.error(`연속매수 방지 저장 실패: ${err.message}`);
    },
  });

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [windowRaw, setWindowRaw] = useState<string | null>(null);
  const [maxCountRaw, setMaxCountRaw] = useState<string | null>(null);
  const [isPendingTrans, startTransition] = useTransition();
  const isSaving = isPendingTrans || updateMutation.isPending;

  // 서버 데이터로 초기화 (로컬 편집 상태가 없을 때만)
  const resolvedEnabled = enabled ?? settings?.enabled ?? false;
  const resolvedWindow = windowRaw ?? String(settings?.windowSeconds ?? 40);
  const resolvedMaxCount = maxCountRaw ?? String(settings?.maxCount ?? 5);
  const serverEnabled = settings?.enabled ?? false;
  const serverWindowSeconds = settings?.windowSeconds ?? 40;
  const serverMaxCount = settings?.maxCount ?? 5;
  const resolvedWindowSeconds = Number(resolvedWindow);
  const resolvedMaxCountNumber = Number(resolvedMaxCount);
  const hasValidValues =
    Number.isInteger(resolvedWindowSeconds) &&
    resolvedWindowSeconds >= 1 &&
    resolvedWindowSeconds <= 3600 &&
    Number.isInteger(resolvedMaxCountNumber) &&
    resolvedMaxCountNumber >= 1 &&
    resolvedMaxCountNumber <= 100;
  const isDirty =
    resolvedEnabled !== serverEnabled ||
    (hasValidValues &&
      (resolvedWindowSeconds !== serverWindowSeconds || resolvedMaxCountNumber !== serverMaxCount));

  if (accountId === null) {
    return (
      <section aria-label="연속매수방지">
        <p className="muted">활성 계좌가 없습니다.</p>
      </section>
    );
  }

  if (isPending) {
    return (
      <section aria-label="연속매수방지">
        <p className="muted">로딩 중…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section aria-label="연속매수방지">
        <p className="chip chip--down" role="alert">
          {error.message}
        </p>
      </section>
    );
  }

  const handleSave = (): void => {
    if (!hasValidValues) return;
    startTransition(() => {
      updateMutation.mutate({
        accountId: accountId,
        enabled: resolvedEnabled,
        windowSeconds: resolvedWindowSeconds,
        maxCount: resolvedMaxCountNumber,
      });
    });
  };

  return (
    <section
      aria-label="연속매수방지"
      style={{
        display: 'grid',
        gap: '0.8rem',
        minWidth: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
        연속 자동매수 방지
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(16rem, 1fr) minmax(20rem, 26rem) auto',
          gap: '0.8rem',
          alignItems: 'center',
          padding: '0.8rem',
          border: '0.1rem solid var(--border)',
          borderRadius: '0.6rem',
          background: resolvedEnabled ? 'var(--bg)' : 'var(--bg-2)',
          opacity: resolvedEnabled ? 1 : 0.72,
        }}
      >
        <div style={{ display: 'grid', gap: '0.2rem', minWidth: 0 }}>
          <span style={{ fontWeight: 700 }}>짧은 시간 내 자동매수 시도</span>
          <span className="muted" style={{ fontSize: '1.05rem' }}>
            N+1번째 자동매수 시도는 차단하고 해당 종목은 매도만 ON으로 전환합니다.
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <label htmlFor="rg-window" className="muted" style={{ fontSize: '1.05rem' }}>
              감지 윈도우
            </label>
            <NumberInput
              id="rg-window"
              value={resolvedWindow}
              onValueChange={(v) => setWindowRaw(v)}
              aria-label="감지 윈도우 초"
              disabled={!resolvedEnabled || isSaving}
              dense
              inputMode="numeric"
            />
          </div>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <label htmlFor="rg-max-count" className="muted" style={{ fontSize: '1.05rem' }}>
              최대 시도 횟수
            </label>
            <NumberInput
              id="rg-max-count"
              value={resolvedMaxCount}
              onValueChange={(v) => setMaxCountRaw(v)}
              aria-label="최대 매수 시도 횟수"
              disabled={!resolvedEnabled || isSaving}
              dense
              inputMode="numeric"
            />
          </div>
        </div>
        <Switch
          checked={resolvedEnabled}
          onChange={(checked) => {
            setEnabled(checked);
            if (checked && resolvedWindow.trim() === '') setWindowRaw('40');
            if (checked && resolvedMaxCount.trim() === '') setMaxCountRaw('5');
          }}
          disabled={isSaving}
          label={resolvedEnabled ? '사용' : '끄기'}
          aria-label="연속 자동매수 방지 사용 여부"
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          onClick={handleSave}
          disabled={isSaving || !isDirty || !hasValidValues}
          variant="primary"
          dense
          aria-label="연속매수방지 저장"
        >
          저장
        </Button>
      </div>
    </section>
  );
};
