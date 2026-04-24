export type Division = 'LIMIT' | 'MARKET';

export interface OrderTicketSelection {
  pdno: string;
  name: string;
  suggestedPrice?: number;
  suggestedSide?: 'BUY' | 'SELL';
}

export interface OrderTicketProps {
  selection: OrderTicketSelection;
  isProd: boolean;
  oneClick: boolean;
  onPlaced?: (result: { odno: string; side: 'BUY' | 'SELL' }) => void;
}
