/**
 * Broker-agnostic order representation consumed by `OrdersPanel`.
 *
 * Adapters in stock / crypto wrappers convert their broker-specific shapes
 * (KIS odno + pdno, UPBIT uuid + market, DecimalString fields) into this
 * normalized form. The base `OrdersPanel` never branches on broker — it only
 * sees normalized numeric fields and stable string identifiers.
 */
export interface NormalizedOrder {
  /** Stable per-row id. KIS odno or UPBIT uuid. */
  id: string;
  /** Raw symbol identifier — pdno (e.g. "256940") or market (e.g. "KRW-BTC"). */
  symbol: string;
  /** Display label shown in the symbol column. e.g. "메리츠금융지주 (256940)" or "KRW-BTC". */
  symbolLabel: string;
  /** Normalized side. KIS BUY/SELL or UPBIT bid→BUY / ask→SELL. */
  side: 'BUY' | 'SELL';
  /** Original requested quantity (number — adapters parse DecimalString). */
  qty: number;
  /** Remaining unfilled quantity. */
  remainingQty: number;
  /** Already filled quantity. */
  filledQty: number;
  /** Order price. Use 0 if MARKET (callers can format via `priceLabel`). */
  price: number;
  /** Pre-formatted price label override. If set, panel renders this instead of `price`. */
  priceLabel?: string;
  /** Display state label (e.g. "체결", "미체결", "wait"). */
  stateLabel: string;
  /** State chip variant (controls chip color). */
  stateVariant?: 'up' | 'down' | 'neutral';
  /** Order placed-at — accepts epoch ms, ISO string, Date, or 0/null/undefined for "no time". */
  placedAt: number | string | Date | null;
  /** Optional secondary warning chip rendered next to the state chip. */
  warning?: { label: string; title?: string };
  /** Whether this row supports cancel action (active orders only). */
  cancellable?: boolean;
  /** Optional fee label for crypto. */
  feeLabel?: string;
  /** Optional executed quantity label override (defaults to filledQty formatting). */
  executedLabel?: string;
  /** Optional remaining quantity label override (defaults to remainingQty formatting). */
  remainingLabel?: string;
  /** Optional original-qty label override. */
  qtyLabel?: string;
  /** Raw passthrough — kept for wrappers that need broker-specific fields downstream. */
  raw?: unknown;
}

/** Columns the panel can render. Wrapper picks the subset/order it needs. */
export type OrdersPanelColumn =
  | 'select'
  | 'time'
  | 'symbol'
  | 'side'
  | 'qty'
  | 'remaining'
  | 'executed'
  | 'price'
  | 'fee'
  | 'state'
  | 'placedAt'
  | 'manage';
