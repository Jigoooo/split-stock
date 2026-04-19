export interface ProtectionLimits {
  perSymbolDailyMaxBuys: number | null;
  dailyTotalMaxAmount: number | null;
  dailyTotalMaxCount: number | null;
  accountTotalMaxAmount: number | null;
  rateGuardEnabled: boolean;
  rateGuardWindowSeconds: number | null;
  rateGuardMaxCount: number | null;
}
