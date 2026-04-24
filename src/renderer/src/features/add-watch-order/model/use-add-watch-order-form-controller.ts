import type { StockListEntry } from '@renderer/entities/stock';
import type { WatchOrder, WatchOrderType, WatchQtyMode } from '@renderer/entities/watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';
import {
  addMonthsIso,
  todayIsoLocal,
  toIsoDateLocal,
  validateAddWatchOrderForm,
} from './add-watch-order-form';
import type { WatchOrderFormPrefill } from './types';

interface UseAddWatchOrderFormControllerParams {
  accountId: number;
  onClose: () => void;
  onSaved: ((order: WatchOrder) => void) | undefined;
  prefill: WatchOrderFormPrefill | null;
}

export interface AddWatchOrderFormController {
  amountKrwRaw: string;
  error: string | null;
  expiresAtIso: string;
  isEdit: boolean;
  isPending: boolean;
  onAmountQuick: (delta: number) => void;
  onAmountReset: () => void;
  onPickExpiry: (months: number) => void;
  onPickStock: (entry: StockListEntry) => void;
  onSubmit: () => Promise<void>;
  orderType: WatchOrderType;
  pdName: string;
  pdno: string;
  qtyMode: WatchQtyMode;
  qtyRaw: string;
  setAmountKrwRaw: (value: string) => void;
  setExpiresAtIso: (value: string) => void;
  setOrderType: (value: WatchOrderType) => void;
  setQtyMode: (value: WatchQtyMode) => void;
  setQtyRaw: (value: string) => void;
  setTargetPriceRaw: (value: string) => void;
  targetPriceRaw: string;
  todayIso: string;
}

export function useAddWatchOrderFormController({
  accountId,
  onClose,
  onSaved,
  prefill,
}: UseAddWatchOrderFormControllerParams): AddWatchOrderFormController {
  const utils = trpc.useUtils();
  const createMutation = trpc.watch.create.useMutation();
  const updateMutation = trpc.watch.update.useMutation();
  const isEdit = prefill?.existingId !== undefined;
  const [pdno, setPdno] = useState<string>(prefill?.pdno ?? '');
  const [pdName, setPdName] = useState<string>(prefill?.pdName ?? '');
  const [targetPriceRaw, setTargetPriceRaw] = useState<string>(
    prefill?.targetPrice !== undefined ? String(prefill.targetPrice) : '',
  );
  const [orderType, setOrderType] = useState<WatchOrderType>(prefill?.orderType ?? 'MARKET');
  const [qtyMode, setQtyMode] = useState<WatchQtyMode>(prefill?.qtyOrAmountMode ?? 'AMOUNT');
  const [qtyRaw, setQtyRaw] = useState<string>(
    prefill?.qty !== undefined ? String(prefill.qty) : '',
  );
  const [amountKrwRaw, setAmountKrwRaw] = useState<string>(
    prefill?.amountKrw !== undefined ? String(prefill.amountKrw) : '',
  );
  const [expiresAtIso, setExpiresAtIso] = useState<string>(
    prefill?.expiresAtMs !== undefined ? toIsoDateLocal(new Date(prefill.expiresAtMs)) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const onPickStock = (entry: StockListEntry): void => {
    setPdno(entry.pdno);
    setPdName(entry.name);
    setError(null);
  };

  const onAmountQuick = (delta: number): void => {
    const parsed = Number(amountKrwRaw);
    const current = Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    setAmountKrwRaw(String(current + delta));
  };

  const onSubmit = async (): Promise<void> => {
    const validation = validateAddWatchOrderForm({
      pdno,
      targetPriceRaw,
      qtyMode,
      qtyRaw,
      amountKrwRaw,
      expiresAtIso,
    });
    if ('error' in validation) {
      setError(validation.error);
      return;
    }

    const value = validation.value;
    setError(null);
    try {
      const payload = {
        accountId,
        pdno,
        targetPrice: value.targetPrice,
        orderType,
        qtyOrAmountMode: qtyMode,
        ...(qtyMode === 'QTY'
          ? { qty: value.qty as number }
          : { amountKrw: value.amountKrw as number }),
        ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt } : {}),
      };
      const result =
        isEdit && prefill?.existingId !== undefined
          ? await updateMutation.mutateAsync({ id: prefill.existingId, ...payload })
          : await createMutation.mutateAsync(payload);
      await utils.watch.list.invalidate();
      await utils.watch.getControlState.invalidate();
      await utils.watch.history.invalidate();
      onSaved?.(result.order as unknown as WatchOrder);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return {
    amountKrwRaw,
    error,
    expiresAtIso,
    isEdit,
    isPending: createMutation.isPending || updateMutation.isPending,
    onAmountQuick,
    onAmountReset: () => setAmountKrwRaw(''),
    onPickExpiry: (months) => setExpiresAtIso(addMonthsIso(months)),
    onPickStock,
    onSubmit,
    orderType,
    pdName,
    pdno,
    qtyMode,
    qtyRaw,
    setAmountKrwRaw,
    setExpiresAtIso,
    setOrderType,
    setQtyMode,
    setQtyRaw,
    setTargetPriceRaw,
    targetPriceRaw,
    todayIso: todayIsoLocal(),
  };
}
