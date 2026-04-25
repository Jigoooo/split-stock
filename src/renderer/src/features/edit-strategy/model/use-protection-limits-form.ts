import { useActiveAccountId } from '@renderer/entities/account';
import { useGetProtectionLimits } from '@renderer/entities/protection-limits';
import { trpc } from '@renderer/shared/api/trpc';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

type RawFields = {
  perSymbolDailyMaxBuysEnabled: boolean;
  perSymbolDailyMaxBuys: string;
  dailyTotalMaxAmountEnabled: boolean;
  dailyTotalMaxAmount: string;
  dailyTotalMaxCountEnabled: boolean;
  dailyTotalMaxCount: string;
  accountTotalMaxAmountEnabled: boolean;
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
      window.appShell?.broadcastSettingsChanged?.('protection');
      toast.success('보호 한도 설정이 저장되었습니다');
    },
    onError: (err) => {
      toast.error(`보호 한도 저장 실패: ${err.message}`);
    },
  });

  const [raw, setRaw] = useState<RawFields | null>(null);
  const [isPendingTrans, startTransition] = useTransition();

  // 로컬 편집이 없으면 서버 데이터로 폴백
  const resolved: RawFields = raw ?? {
    perSymbolDailyMaxBuysEnabled: limits?.perSymbolDailyMaxBuysEnabled ?? false,
    perSymbolDailyMaxBuys: String(limits?.perSymbolDailyMaxBuys ?? ''),
    dailyTotalMaxAmountEnabled: limits?.dailyTotalMaxAmountEnabled ?? false,
    dailyTotalMaxAmount: String(limits?.dailyTotalMaxAmount ?? ''),
    dailyTotalMaxCountEnabled: limits?.dailyTotalMaxCountEnabled ?? false,
    dailyTotalMaxCount: String(limits?.dailyTotalMaxCount ?? ''),
    accountTotalMaxAmountEnabled: limits?.accountTotalMaxAmountEnabled ?? false,
    accountTotalMaxAmount: String(limits?.accountTotalMaxAmount ?? ''),
  };

  const handleFieldChange = (field: keyof RawFields, value: string | boolean): void => {
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
        perSymbolDailyMaxBuysEnabled: resolved.perSymbolDailyMaxBuysEnabled,
        perSymbolDailyMaxBuys: toNullable(resolved.perSymbolDailyMaxBuys),
        dailyTotalMaxAmountEnabled: resolved.dailyTotalMaxAmountEnabled,
        dailyTotalMaxAmount: toNullable(resolved.dailyTotalMaxAmount),
        dailyTotalMaxCountEnabled: resolved.dailyTotalMaxCountEnabled,
        dailyTotalMaxCount: toNullable(resolved.dailyTotalMaxCount),
        accountTotalMaxAmountEnabled: resolved.accountTotalMaxAmountEnabled,
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
