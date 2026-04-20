import { useActiveAccountId } from '@renderer/entities/account';
import { useRateGuardSettings } from '@renderer/entities/rate-guard';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, Checkbox, NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useState, useTransition } from 'react';

/**
 * 연속매수 방지(rate-guard) 설정 폼.
 * - 활성화 토글
 * - 윈도우 시간(초) 입력
 * - 최대 매수 횟수 입력
 */
export const RateGuardForm = (): ReactElement => {
  const { accountId } = useActiveAccountId();
  const { isPending, error, settings } = useRateGuardSettings(accountId);
  const utils = trpc.useUtils();
  const updateMutation = trpc.rateGuard.updateSettings.useMutation({
    onSuccess: () => {
      void utils.rateGuard.getSettings.invalidate();
    },
  });

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [windowRaw, setWindowRaw] = useState<string | null>(null);
  const [maxCountRaw, setMaxCountRaw] = useState<string | null>(null);
  const [isPendingTrans, startTransition] = useTransition();

  // 서버 데이터로 초기화 (로컬 편집 상태가 없을 때만)
  const resolvedEnabled = enabled ?? settings?.enabled ?? false;
  const resolvedWindow = windowRaw ?? String(settings?.windowSeconds ?? 40);
  const resolvedMaxCount = maxCountRaw ?? String(settings?.maxCount ?? 5);

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
    const ws = Number(resolvedWindow);
    const mc = Number(resolvedMaxCount);
    if (!Number.isInteger(ws) || ws < 1 || ws > 3600) return;
    if (!Number.isInteger(mc) || mc < 1 || mc > 100) return;
    startTransition(() => {
      updateMutation.mutate({
        accountId: accountId,
        enabled: resolvedEnabled,
        windowSeconds: ws,
        maxCount: mc,
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
        연속매수 방지 (N+1회 발생 시 자동매매 수동 전환)
      </div>

      {/* Checkbox 자체가 내부에 label을 렌더링하므로 외부 label 미사용 */}
      <Checkbox
        checked={resolvedEnabled}
        onChange={(e) => setEnabled(e.target.checked)}
        disabled={isPendingTrans}
        label="활성화"
      />

      <div style={{ display: 'grid', gap: '0.3rem' }}>
        <label htmlFor="rg-window" className="muted" style={{ fontSize: '1.1rem' }}>
          감지 윈도우 (초, 1~3600)
        </label>
        <NumberInput
          id="rg-window"
          value={resolvedWindow}
          onValueChange={(v) => setWindowRaw(v)}
          aria-label="감지 윈도우 초"
          disabled={!resolvedEnabled || isPendingTrans}
          dense
          inputMode="numeric"
        />
      </div>

      <div style={{ display: 'grid', gap: '0.3rem' }}>
        <label htmlFor="rg-max-count" className="muted" style={{ fontSize: '1.1rem' }}>
          최대 매수 횟수 (1~100)
        </label>
        <NumberInput
          id="rg-max-count"
          value={resolvedMaxCount}
          onValueChange={(v) => setMaxCountRaw(v)}
          aria-label="최대 매수 횟수"
          disabled={!resolvedEnabled || isPendingTrans}
          dense
          inputMode="numeric"
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          onClick={handleSave}
          disabled={isPendingTrans}
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
