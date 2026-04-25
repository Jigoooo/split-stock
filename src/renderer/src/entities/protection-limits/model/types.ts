export interface ProtectionLimits {
  perSymbolDailyMaxBuysEnabled: boolean;
  perSymbolDailyMaxBuys: number | null;
  dailyTotalMaxAmountEnabled: boolean;
  dailyTotalMaxAmount: number | null;
  dailyTotalMaxCountEnabled: boolean;
  dailyTotalMaxCount: number | null;
  accountTotalMaxAmountEnabled: boolean;
  accountTotalMaxAmount: number | null;
  rateGuardEnabled: boolean;
  rateGuardWindowSeconds: number | null;
  rateGuardMaxCount: number | null;
}
