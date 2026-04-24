import type { WatchQtyMode } from '@renderer/entities/watch-order';

export interface AddWatchOrderFormValues {
  pdno: string;
  targetPriceRaw: string;
  qtyMode: WatchQtyMode;
  qtyRaw: string;
  amountKrwRaw: string;
  expiresAtIso: string;
}

export interface AddWatchOrderSubmitValue {
  targetPrice: number;
  qty?: number;
  amountKrw?: number;
  expiresAt?: number;
}

export interface AmountPreview {
  qty: number;
  filled: number;
  remainder: number;
  isHighRemainder: boolean;
}

function toIntOrNull(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function calcAmountPreview(
  amountKrwRaw: string,
  targetPriceRaw: string,
): AmountPreview | null {
  const amount = toIntOrNull(amountKrwRaw);
  const price = toIntOrNull(targetPriceRaw);
  if (amount === null || price === null) return null;
  const qty = Math.floor(amount / price);
  if (qty <= 0) return null;
  const filled = qty * price;
  const remainder = amount - filled;
  return { qty, filled, remainder, isHighRemainder: remainder >= amount * 0.5 };
}

export function toIsoDateLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function todayIsoLocal(): string {
  return toIsoDateLocal(new Date());
}

export function addMonthsIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return toIsoDateLocal(d);
}

export function validateAddWatchOrderForm(
  values: AddWatchOrderFormValues,
): { error: string } | { value: AddWatchOrderSubmitValue } {
  if (!/^\d{6}$/.test(values.pdno)) {
    return { error: '종목을 검색해서 선택해주세요.' };
  }

  const targetPrice = toIntOrNull(values.targetPriceRaw);
  if (targetPrice === null) {
    return { error: '감시가격(목표가)을 양의 정수로 입력하세요.' };
  }

  let qty: number | undefined;
  let amountKrw: number | undefined;
  if (values.qtyMode === 'QTY') {
    const nextQty = toIntOrNull(values.qtyRaw);
    if (nextQty === null) {
      return { error: '수량을 양의 정수로 입력하세요.' };
    }
    qty = nextQty;
  } else {
    const nextAmount = toIntOrNull(values.amountKrwRaw);
    if (nextAmount === null) {
      return { error: '주문금액을 양의 정수로 입력하세요.' };
    }
    amountKrw = nextAmount;
  }

  let expiresAt: number | undefined;
  if (values.expiresAtIso.trim() !== '') {
    const ts = Date.parse(`${values.expiresAtIso}T23:59:59`);
    if (!Number.isFinite(ts) || ts <= Date.now()) {
      return { error: '유효일은 오늘 이후 날짜를 선택하세요.' };
    }
    expiresAt = ts;
  }

  const result: AddWatchOrderSubmitValue = { targetPrice };
  if (qty !== undefined) result.qty = qty;
  if (amountKrw !== undefined) result.amountKrw = amountKrw;
  if (expiresAt !== undefined) result.expiresAt = expiresAt;
  return { value: result };
}
