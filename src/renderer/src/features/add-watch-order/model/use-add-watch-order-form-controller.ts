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

interface FormState {
  pdno: string;
  pdName: string;
  targetPriceRaw: string;
  orderType: WatchOrderType;
  qtyMode: WatchQtyMode;
  qtyRaw: string;
  amountKrwRaw: string;
  expiresAtIso: string;
}

function initialFormState(prefill: WatchOrderFormPrefill | null): FormState {
  return {
    pdno: prefill?.pdno ?? '',
    pdName: prefill?.pdName ?? '',
    targetPriceRaw: prefill?.targetPrice !== undefined ? String(prefill.targetPrice) : '',
    orderType: prefill?.orderType ?? 'MARKET',
    qtyMode: prefill?.qtyOrAmountMode ?? 'AMOUNT',
    qtyRaw: prefill?.qty !== undefined ? String(prefill.qty) : '',
    amountKrwRaw: prefill?.amountKrw !== undefined ? String(prefill.amountKrw) : '',
    expiresAtIso:
      prefill?.expiresAtMs !== undefined ? toIsoDateLocal(new Date(prefill.expiresAtMs)) : '',
  };
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

  const [form, setForm] = useState<FormState>(() => initialFormState(prefill));
  const [error, setError] = useState<string | null>(null);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onPickStock = (entry: StockListEntry): void => {
    setForm((prev) => ({ ...prev, pdno: entry.pdno, pdName: entry.name }));
    setError(null);
  };

  const onAmountQuick = (delta: number): void => {
    const parsed = Number(form.amountKrwRaw);
    const current = Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    patch('amountKrwRaw', String(current + delta));
  };

  const onSubmit = async (): Promise<void> => {
    const validation = validateAddWatchOrderForm({
      pdno: form.pdno,
      targetPriceRaw: form.targetPriceRaw,
      qtyMode: form.qtyMode,
      qtyRaw: form.qtyRaw,
      amountKrwRaw: form.amountKrwRaw,
      expiresAtIso: form.expiresAtIso,
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
        pdno: form.pdno,
        targetPrice: value.targetPrice,
        orderType: form.orderType,
        qtyOrAmountMode: form.qtyMode,
        ...(form.qtyMode === 'QTY'
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
    amountKrwRaw: form.amountKrwRaw,
    error,
    expiresAtIso: form.expiresAtIso,
    isEdit,
    isPending: createMutation.isPending || updateMutation.isPending,
    onAmountQuick,
    onAmountReset: () => patch('amountKrwRaw', ''),
    onPickExpiry: (months) => patch('expiresAtIso', addMonthsIso(months)),
    onPickStock,
    onSubmit,
    orderType: form.orderType,
    pdName: form.pdName,
    pdno: form.pdno,
    qtyMode: form.qtyMode,
    qtyRaw: form.qtyRaw,
    setAmountKrwRaw: (v) => patch('amountKrwRaw', v),
    setExpiresAtIso: (v) => patch('expiresAtIso', v),
    setOrderType: (v) => patch('orderType', v),
    setQtyMode: (v) => patch('qtyMode', v),
    setQtyRaw: (v) => patch('qtyRaw', v),
    setTargetPriceRaw: (v) => patch('targetPriceRaw', v),
    targetPriceRaw: form.targetPriceRaw,
    todayIso: todayIsoLocal(),
  };
}
