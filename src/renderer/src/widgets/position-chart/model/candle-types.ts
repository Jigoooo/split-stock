export type ChartPeriod = 'D' | 'W' | 'M';

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
