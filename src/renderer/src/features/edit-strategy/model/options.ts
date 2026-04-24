import type { StrategyAutoMode, StrategyOrderType } from '@shared/contracts';

export const STRATEGY_AUTO_MODE_OPTIONS = [
  { value: 'ALL_ON', label: '전체 ON' },
  { value: 'ALL_OFF', label: '전체 OFF' },
  { value: 'BUY_ONLY', label: '매수만 ON' },
  { value: 'SELL_ONLY', label: '매도만 ON' },
] as const satisfies ReadonlyArray<{ value: StrategyAutoMode; label: string }>;

export const ORDER_TYPE_OPTIONS = [
  { value: 'LIMIT', label: '지정가' },
  { value: 'MARKET', label: '시장가' },
] as const satisfies ReadonlyArray<{ value: StrategyOrderType; label: string }>;
