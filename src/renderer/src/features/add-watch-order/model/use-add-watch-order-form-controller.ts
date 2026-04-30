import type { StockListEntry } from '@renderer/entities/stock';
import type { WatchOrder, WatchOrderType, WatchQtyMode } from '@renderer/entities/watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useMemo, useState } from 'react';
import {
  type AddWatchOrderFormErrors,
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
  applyDraftRecommendation: () => void;
  applyPriceCandidate: (id: ReservationBuyPriceCandidate['id']) => void;
  currentPrice: number | null;
  draft: ReservationBuyDraft | null;
  draftError: string | null;
  error: string | null;
  errors: AddWatchOrderFormErrors;
  expiresAtIso: string;
  isEdit: boolean;
  isDraftLoading: boolean;
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
  selectedPriceCandidateId: ReservationBuyPriceCandidate['id'] | null;
  setAmountKrwRaw: (value: string) => void;
  setExpiresAtIso: (value: string) => void;
  setOrderType: (value: WatchOrderType) => void;
  setQtyMode: (value: WatchQtyMode) => void;
  setQtyRaw: (value: string) => void;
  setTargetPriceRaw: (value: string) => void;
  targetPriceRaw: string;
  targetPriceDistancePct: number | null;
  targetPriceImmediateWarning: string | null;
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

interface DirtyFields {
  amountKrwRaw: boolean;
  expiresAtIso: boolean;
  orderType: boolean;
  qtyMode: boolean;
  qtyRaw: boolean;
  targetPriceRaw: boolean;
}

export interface ReservationBuyPriceCandidate {
  id: 'nearest-support' | 'box-low' | 'pullback-2';
  label: string;
  price: number;
  distancePct: number;
  reason: string;
  confidence: 'high' | 'med' | 'low';
}

export interface ReservationBuyDraft {
  quote: {
    symbol: string;
    price: number;
    dayChange: number;
    dayChangeRate: number;
    accumVolume: number;
    open: number;
    high: number;
    low: number;
    upperLimit: number;
    lowerLimit: number;
    prevClose: number;
  } | null;
  orderbookTop: {
    bestAsk: number | null;
    bestBid: number | null;
    expectedPrice: number | null;
  };
  rangeContext: {
    candleCount: number;
    dataQuality: 'blocked' | 'limited' | 'normal';
    dataQualityReason: string;
    analysisConfidence: 'high' | 'med' | 'low';
    lastClose: number | null;
    box: { high: number; low: number; mid: number } | null;
    supportResistance: {
      supports: number[];
      resistances: number[];
      nearestSupportPct: number | null;
      nearestResistancePct: number | null;
    } | null;
    rangePct120d: number | null;
  };
  priceCandidates: ReservationBuyPriceCandidate[];
  recommended: {
    targetPrice: number | null;
    priceCandidateId: ReservationBuyPriceCandidate['id'] | null;
    orderType: 'LIMIT';
    qtyOrAmountMode: 'AMOUNT';
    amountKrw: number;
    expiresAtMs: number;
  };
  warnings: string[];
  sourceStatus: {
    quote: string;
    orderbook: string;
    candles: string;
    strategy: string;
  };
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

function initialDirtyFields(prefill: WatchOrderFormPrefill | null): DirtyFields {
  return {
    amountKrwRaw: prefill?.amountKrw !== undefined,
    expiresAtIso: prefill?.expiresAtMs !== undefined,
    orderType: prefill?.orderType !== undefined,
    qtyMode: prefill?.qtyOrAmountMode !== undefined,
    qtyRaw: prefill?.qty !== undefined,
    targetPriceRaw: prefill?.targetPrice !== undefined,
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
  const [dirtyFields, setDirtyFields] = useState<DirtyFields>(() => initialDirtyFields(prefill));
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<AddWatchOrderFormErrors>({});

  const draftQuery = trpc.watch.getReservationBuyDraft.useQuery(
    { accountId, pdno: form.pdno },
    {
      enabled: accountId > 0 && /^\d{6}$/.test(form.pdno),
      staleTime: 30_000,
    },
  );
  const draft = (draftQuery.data ?? null) as ReservationBuyDraft | null;

  const patch = <K extends keyof FormState>(
    key: K,
    value: FormState[K],
    opts: { dirty?: boolean } = {},
  ): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (opts.dirty !== false && key in dirtyFields) {
      setDirtyFields((prev) => ({ ...prev, [key]: true }));
    }
    setErrors({});
  };

  const onPickStock = (entry: StockListEntry): void => {
    setForm((prev) => ({ ...prev, pdno: entry.pdno, pdName: entry.name }));
    setError(null);
    setErrors({});
  };

  const onAmountQuick = (delta: number): void => {
    const parsed = Number(form.amountKrwRaw);
    const current = Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    patch('amountKrwRaw', String(current + delta));
  };

  useEffect(() => {
    if (!draft) return;
    setForm((prev) => {
      const next: FormState = { ...prev };
      let changed = false;
      const setIfPristine = <K extends keyof DirtyFields>(key: K, value: FormState[K]): void => {
        if (dirtyFields[key]) return;
        if (next[key] === value) return;
        next[key] = value;
        changed = true;
      };

      if (draft.recommended.targetPrice !== null) {
        setIfPristine('targetPriceRaw', String(draft.recommended.targetPrice));
      }
      setIfPristine('orderType', draft.recommended.orderType);
      setIfPristine('qtyMode', draft.recommended.qtyOrAmountMode);
      setIfPristine('amountKrwRaw', String(draft.recommended.amountKrw));
      setIfPristine('expiresAtIso', toIsoDateLocal(new Date(draft.recommended.expiresAtMs)));
      return changed ? next : prev;
    });
  }, [draft, dirtyFields]);

  const applyDraftValues = (targetPrice: number | null): void => {
    if (!draft) return;
    setForm((prev) => ({
      ...prev,
      ...(targetPrice !== null ? { targetPriceRaw: String(targetPrice) } : {}),
      orderType: draft.recommended.orderType,
      qtyMode: draft.recommended.qtyOrAmountMode,
      amountKrwRaw: String(draft.recommended.amountKrw),
      expiresAtIso: toIsoDateLocal(new Date(draft.recommended.expiresAtMs)),
    }));
    setDirtyFields((prev) => ({
      ...prev,
      ...(targetPrice !== null ? { targetPriceRaw: true } : {}),
      orderType: true,
      qtyMode: true,
      amountKrwRaw: true,
      expiresAtIso: true,
    }));
    setErrors({});
    setError(null);
  };

  const applyDraftRecommendation = (): void => {
    applyDraftValues(draft?.recommended.targetPrice ?? null);
  };

  const applyPriceCandidate = (id: ReservationBuyPriceCandidate['id']): void => {
    const candidate = draft?.priceCandidates.find((item) => item.id === id);
    applyDraftValues(candidate?.price ?? null);
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
    if ('errors' in validation) {
      setErrors(validation.errors);
      setError(validation.errors.form ?? null);
      return;
    }

    const value = validation.value;
    setError(null);
    setErrors({});
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
      setErrors({ form: caught instanceof Error ? caught.message : String(caught) });
    }
  };

  const currentPrice = draft?.quote?.price ?? null;
  const targetPrice = parsePositiveInt(form.targetPriceRaw);
  const targetPriceDistancePct =
    currentPrice !== null && targetPrice !== null && currentPrice > 0
      ? Math.round(((targetPrice - currentPrice) / currentPrice) * 1000) / 10
      : null;
  const targetPriceImmediateWarning =
    currentPrice !== null && targetPrice !== null && targetPrice >= currentPrice
      ? '저장 직후 실행 가능 — 감시가격이 현재가 이상입니다.'
      : null;
  const selectedPriceCandidateId = useMemo(() => {
    if (!draft || targetPrice === null) return null;
    return draft.priceCandidates.find((candidate) => candidate.price === targetPrice)?.id ?? null;
  }, [draft, targetPrice]);

  return {
    amountKrwRaw: form.amountKrwRaw,
    applyDraftRecommendation,
    applyPriceCandidate,
    currentPrice,
    draft,
    draftError: draftQuery.error ? draftQuery.error.message : null,
    error,
    errors,
    expiresAtIso: form.expiresAtIso,
    isEdit,
    isDraftLoading: draftQuery.isLoading,
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
    selectedPriceCandidateId,
    setAmountKrwRaw: (v) => patch('amountKrwRaw', v),
    setExpiresAtIso: (v) => patch('expiresAtIso', v),
    setOrderType: (v) => patch('orderType', v),
    setQtyMode: (v) => patch('qtyMode', v),
    setQtyRaw: (v) => patch('qtyRaw', v),
    setTargetPriceRaw: (v) => patch('targetPriceRaw', v),
    targetPriceRaw: form.targetPriceRaw,
    targetPriceDistancePct,
    targetPriceImmediateWarning,
    todayIso: todayIsoLocal(),
  };
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value.replaceAll(',', '').trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}
