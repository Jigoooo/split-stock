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

type ProtectionLimitsPayload = {
  perSymbolDailyMaxBuysEnabled: boolean;
  perSymbolDailyMaxBuys: number | null;
  dailyTotalMaxAmountEnabled: boolean;
  dailyTotalMaxAmount: number | null;
  dailyTotalMaxCountEnabled: boolean;
  dailyTotalMaxCount: number | null;
  accountTotalMaxAmountEnabled: boolean;
  accountTotalMaxAmount: number | null;
};

const toNullable = (value: string): number | null => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const rawToPayload = (raw: RawFields): ProtectionLimitsPayload => ({
  perSymbolDailyMaxBuysEnabled: raw.perSymbolDailyMaxBuysEnabled,
  perSymbolDailyMaxBuys: toNullable(raw.perSymbolDailyMaxBuys),
  dailyTotalMaxAmountEnabled: raw.dailyTotalMaxAmountEnabled,
  dailyTotalMaxAmount: toNullable(raw.dailyTotalMaxAmount),
  dailyTotalMaxCountEnabled: raw.dailyTotalMaxCountEnabled,
  dailyTotalMaxCount: toNullable(raw.dailyTotalMaxCount),
  accountTotalMaxAmountEnabled: raw.accountTotalMaxAmountEnabled,
  accountTotalMaxAmount: toNullable(raw.accountTotalMaxAmount),
});

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
  const server: RawFields = {
    perSymbolDailyMaxBuysEnabled: limits?.perSymbolDailyMaxBuysEnabled ?? false,
    perSymbolDailyMaxBuys: String(limits?.perSymbolDailyMaxBuys ?? ''),
    dailyTotalMaxAmountEnabled: limits?.dailyTotalMaxAmountEnabled ?? false,
    dailyTotalMaxAmount: String(limits?.dailyTotalMaxAmount ?? ''),
    dailyTotalMaxCountEnabled: limits?.dailyTotalMaxCountEnabled ?? false,
    dailyTotalMaxCount: String(limits?.dailyTotalMaxCount ?? ''),
    accountTotalMaxAmountEnabled: limits?.accountTotalMaxAmountEnabled ?? false,
    accountTotalMaxAmount: String(limits?.accountTotalMaxAmount ?? ''),
  };
  const payload = rawToPayload(resolved);
  const isDirty = JSON.stringify(payload) !== JSON.stringify(rawToPayload(server));

  const handleFieldChange = (field: keyof RawFields, value: string | boolean): void => {
    setRaw((prev) => ({ ...(prev ?? resolved), [field]: value }));
  };

  const handleSave = (): void => {
    if (accountId === null) return;
    startTransition(() => {
      updateMutation.mutate({
        accountId,
        ...payload,
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
    isDirty,
    handleFieldChange,
    handleSave,
  };
}
