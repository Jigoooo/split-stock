import type { StrategyAutoMode, StrategyOrderType } from '@shared/contracts';

export interface StageRuleRowRaw {
  nth: number;
  amountKrw: string;
  targetProfitPct: string;
  triggerDropPct: string;
}

export type FormRaw = {
  maxStages: string;
  autoBuyOrderType: StrategyOrderType;
  autoMode: StrategyAutoMode;
  autoSellOrderType: StrategyOrderType;
};

export type FormChrome = 'panel' | 'content';
export type ApplyScope = 'active' | 'all';
export type StageRuleField = keyof Omit<StageRuleRowRaw, 'nth'>;
export type StageRuleChangeFactory = (nth: number, key: StageRuleField) => (value: string) => void;
