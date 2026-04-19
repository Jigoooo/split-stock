import { Button, NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useProtectionLimitsForm } from '../model/use-protection-limits-form';

/**
 * 보호 한도 입력 폼.
 * - 종목별 1일 최대 매수 횟수
 * - 1일 총 최대 매수 금액
 * - 1일 총 최대 매수 건수
 * - 계좌 총 최대 매수 금액
 * 빈 값 = 제한 없음 (null 저장)
 */
export const ProtectionLimitsForm = (): ReactElement => {
  const { accountId, isPending, error, resolved, isSaving, handleFieldChange, handleSave } =
    useProtectionLimitsForm();

  if (accountId === null) {
    return (
      <section aria-label="보호 한도">
        <p className="muted">활성 계좌가 없습니다.</p>
      </section>
    );
  }

  if (isPending) {
    return (
      <section aria-label="보호 한도">
        <p className="muted">로딩 중…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section aria-label="보호 한도">
        <p className="chip chip--down" role="alert">
          {error.message}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="보호 한도" style={{ display: 'grid', gap: '0.8rem' }}>
      <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
        보호 한도 (빈 값 = 제한 없음)
      </div>

      <div style={{ display: 'grid', gap: '0.3rem' }}>
        <label htmlFor="pl-per-symbol" className="muted" style={{ fontSize: '1.1rem' }}>
          종목별 1일 최대 매수 횟수
        </label>
        <NumberInput
          id="pl-per-symbol"
          value={resolved.perSymbolDailyMaxBuys}
          onValueChange={(v) => handleFieldChange('perSymbolDailyMaxBuys', v)}
          aria-label="종목별 1일 최대 매수 횟수"
          disabled={isSaving}
          dense
          inputMode="numeric"
        />
      </div>

      <div style={{ display: 'grid', gap: '0.3rem' }}>
        <label htmlFor="pl-daily-amount" className="muted" style={{ fontSize: '1.1rem' }}>
          1일 총 최대 매수 금액 (원)
        </label>
        <NumberInput
          id="pl-daily-amount"
          value={resolved.dailyTotalMaxAmount}
          onValueChange={(v) => handleFieldChange('dailyTotalMaxAmount', v)}
          aria-label="1일 총 최대 매수 금액"
          disabled={isSaving}
          dense
          inputMode="numeric"
        />
      </div>

      <div style={{ display: 'grid', gap: '0.3rem' }}>
        <label htmlFor="pl-daily-count" className="muted" style={{ fontSize: '1.1rem' }}>
          1일 총 최대 매수 건수
        </label>
        <NumberInput
          id="pl-daily-count"
          value={resolved.dailyTotalMaxCount}
          onValueChange={(v) => handleFieldChange('dailyTotalMaxCount', v)}
          aria-label="1일 총 최대 매수 건수"
          disabled={isSaving}
          dense
          inputMode="numeric"
        />
      </div>

      <div style={{ display: 'grid', gap: '0.3rem' }}>
        <label htmlFor="pl-account-amount" className="muted" style={{ fontSize: '1.1rem' }}>
          계좌 총 최대 매수 금액 (원)
        </label>
        <NumberInput
          id="pl-account-amount"
          value={resolved.accountTotalMaxAmount}
          onValueChange={(v) => handleFieldChange('accountTotalMaxAmount', v)}
          aria-label="계좌 총 최대 매수 금액"
          disabled={isSaving}
          dense
          inputMode="numeric"
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          variant="primary"
          dense
          aria-label="보호 한도 저장"
        >
          저장
        </Button>
      </div>
    </section>
  );
};
