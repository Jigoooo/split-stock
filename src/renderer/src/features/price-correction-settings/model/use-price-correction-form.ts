import type { PriceCorrectionStrategy } from '@renderer/entities/price-correction-settings';
import { useGetPriceCorrectionSettings } from '@renderer/entities/price-correction-settings';
import { trpc } from '@renderer/shared/api/trpc';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

/**
 * 호가 자동 보정 설정 폼 상태 관리.
 * - 로컬 편집 상태를 서버 데이터와 분리
 * - 저장 성공 시 로컬 상태 초기화
 */
export function usePriceCorrectionForm() {
  const { isPending, error, settings } = useGetPriceCorrectionSettings();
  const utils = trpc.useUtils();
  const updateMutation = trpc.priceCorrection.updateSettings.useMutation({
    onSuccess: () => {
      void utils.priceCorrection.getSettings.invalidate();
      window.appShell?.broadcastSettingsChanged?.('priceCorrection');
      toast.success('호가 자동 보정 설정이 저장되었습니다');
      setLocalBuy(null);
      setLocalSell(null);
    },
    onError: (err) => {
      toast.error(`호가 자동 보정 저장 실패: ${err.message}`);
    },
  });

  const [localBuy, setLocalBuy] = useState<PriceCorrectionStrategy | null>(null);
  const [localSell, setLocalSell] = useState<PriceCorrectionStrategy | null>(null);
  const [isPendingTrans, startTransition] = useTransition();

  const resolvedBuy: PriceCorrectionStrategy = localBuy ?? settings?.buy ?? 'AGGRESSIVE';
  const resolvedSell: PriceCorrectionStrategy = localSell ?? settings?.sell ?? 'AGGRESSIVE';
  const serverBuy: PriceCorrectionStrategy = settings?.buy ?? 'AGGRESSIVE';
  const serverSell: PriceCorrectionStrategy = settings?.sell ?? 'AGGRESSIVE';
  const isDirty = resolvedBuy !== serverBuy || resolvedSell !== serverSell;

  const handleBuyChange = (value: PriceCorrectionStrategy): void => {
    setLocalBuy(value);
  };

  const handleSellChange = (value: PriceCorrectionStrategy): void => {
    setLocalSell(value);
  };

  const handleSave = (): void => {
    startTransition(() => {
      updateMutation.mutate({ buy: resolvedBuy, sell: resolvedSell });
    });
  };

  return {
    isPending,
    error,
    resolvedBuy,
    resolvedSell,
    isSaving: isPendingTrans || updateMutation.isPending,
    isDirty,
    handleBuyChange,
    handleSellChange,
    handleSave,
  };
}
