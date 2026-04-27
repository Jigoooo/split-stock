import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { AlertTriangle } from 'lucide-react';
import type { ReactElement } from 'react';
import type { Division, OrderTicketSelection } from '../model/order-ticket-types';

interface OrderConfirmSummaryProps {
  division: Division;
  divisionLabel: string;
  isProd: boolean;
  nextNth: number;
  priceLabel: string;
  qty: number;
  selection: OrderTicketSelection;
  side: 'BUY' | 'SELL';
  sideLabel: string;
}

export const OrderConfirmSummary = ({
  division,
  divisionLabel,
  isProd,
  nextNth,
  priceLabel,
  qty,
  selection,
  side,
  sideLabel,
}: OrderConfirmSummaryProps): ReactElement => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', paddingTop: '0.2rem' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.6rem',
        }}
      >
        <span style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.95em' }}>종목</span>
        <span style={{ fontSize: '1.1em', fontWeight: 600 }}>
          <span
            className="num"
            style={{
              fontSize: '0.85em',
              color: 'var(--color-text-secondary, #888)',
              marginRight: '0.4rem',
              fontWeight: 'normal',
            }}
          >
            {selection.pdno}
          </span>
          {selection.name}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.6rem',
        }}
      >
        <span style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.95em' }}>구분</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <strong className={side === 'BUY' ? 'num-up' : 'num-down'}>{sideLabel}</strong>
          <span style={{ color: 'var(--color-border, #ccc)' }}>|</span>
          <span>{divisionLabel}</span>
          {side === 'BUY' ? (
            <>
              <span style={{ color: 'var(--color-border, #ccc)' }}>|</span>
              <span className="chip">{nextNth}차</span>
            </>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.6rem',
        }}
      >
        <span style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.95em' }}>단가</span>
        <span className="num" style={{ fontSize: '1.1em', fontWeight: 600 }}>
          {division === 'MARKET' ? '시장가' : priceLabel}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.6rem',
        }}
      >
        <span style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.95em' }}>수량</span>
        <span className="num" style={{ fontSize: '1.1em', fontWeight: 600 }}>
          {thousandSeparator(String(qty))}주
        </span>
      </div>
    </div>

    {isProd ? (
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          color: 'var(--down, #d32f2f)',
          fontSize: '0.95em',
          marginTop: '0.2rem',
        }}
      >
        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
        <div>
          <strong>실전 계좌 주문</strong>
          <br />
          실제 주문이 체결됩니다. 종목·수량·가격을 다시 확인하세요.
        </div>
      </div>
    ) : null}
  </div>
);
