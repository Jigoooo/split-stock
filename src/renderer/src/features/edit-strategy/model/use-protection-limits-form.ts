import { useActiveAccountId } from '@renderer/entities/account';
import { useGetProtectionLimits } from '@renderer/entities/protection-limits';
import { trpc } from '@renderer/shared/api/trpc';
import { useState, useTransition } from 'react';

type RawFields = {
  perSymbolDailyMaxBuys: string;
  dailyTotalMaxAmount: string;
  dailyTotalMaxCount: string;
  accountTotalMaxAmount: string;
};

/**
 * 보호 한도 폼 상태 관리.
 * - 로컬 편집 상태(raw string)를 서버 데이터와 분리
 * - 저장 시 정수 변환 후 upsert
 */
export function useProtectionLimitsForm() {
  const { accountId } = useActiveAccountId();
  const { isPending, error, limits } = useGetProtectionLimits(accountId);
  const utils = trpc.useUtils();
  const updateMutation = trpc.protection.set.useMutation({
    onSuccess: () => {
      if (accountId !== null) {
        void utils.protection.get.invalidate({ accountId });
      }
    },
  });

  const [raw, setRaw] = useState<RawFields | null>(null);
  const [isPendingTrans, startTransition] = useTransition();

  // 로컬 편집이 없으면 서버 데이터로 폴백
  const resolved: RawFields = raw ?? {
    perSymbolDailyMaxBuys: String(limits?.perSymbolDailyMaxBuys ?? ''),
    dailyTotalMaxAmount: String(limits?.dailyTotalMaxAmount ?? ''),
    dailyTotalMaxCount: String(limits?.dailyTotalMaxCount ?? ''),
    accountTotalMaxAmount: String(limits?.accountTotalMaxAmount ?? ''),
  };

  const handleFieldChange = (field: keyof RawFields, value: string): void => {
    setRaw((prev) => ({ ...(prev ?? resolved), [field]: value }));
  };

  const handleSave = (): void => {
    if (accountId === null) return;
    const toNullable = (s: string): number | null => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    startTransition(() => {
      updateMutation.mutate({
        accountId,
        perSymbolDailyMaxBuys: toNullable(resolved.perSymbolDailyMaxBuys),
        dailyTotalMaxAmount: toNullable(resolved.dailyTotalMaxAmount),
        dailyTotalMaxCount: toNullable(resolved.dailyTotalMaxCount),
        accountTotalMaxAmount: toNullable(resolved.accountTotalMaxAmount),
      });
      setRaw(null);
    });
  };

  return {
    accountId,
    isPending,
    error,
    resolved,
    isSaving: isPendingTrans || updateMutation.isPending,
    handleFieldChange,
    handleSave,
  };
}
