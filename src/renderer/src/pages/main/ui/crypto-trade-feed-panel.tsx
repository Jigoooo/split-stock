import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { formatCryptoPrice, formatCryptoVolume } from '../model/crypto-format';
import { formatTradeTime } from '../model/crypto-formatters';

export const CryptoTradeFeedPanel = ({
  market,
  trades,
}: {
  market: string;
  trades: Array<{ askBid: string; id: string; price: string; timestamp: number; volume: string }>;
}): ReactElement => (
  <section className="panel crypto-trade-feed">
    <div className="panel__title">실시간 체결</div>
    <TableGrid.Root variant="hts" stickyHeader horizontalScroll style={{ flex: 1, minHeight: 0 }}>
      <TableGrid.Header>
        <TableGrid.Cell width="8.8rem">시각</TableGrid.Cell>
        <TableGrid.Cell width="10rem" numeric>
          체결가
        </TableGrid.Cell>
        <TableGrid.Cell width="9rem" numeric>
          수량
        </TableGrid.Cell>
      </TableGrid.Header>
      <TableGrid.Body>
        {trades.map((trade) => (
          <TableGrid.Row key={trade.id}>
            <TableGrid.Cell width="8.8rem" className="date-time-cell">
              {formatTradeTime(trade.timestamp)}
            </TableGrid.Cell>
            <TableGrid.Cell
              width="10rem"
              numeric
              className={trade.askBid === 'ASK' ? 'num-down' : 'num-up'}
            >
              {formatCryptoPrice(trade.price, market)}
            </TableGrid.Cell>
            <TableGrid.Cell width="9rem" numeric>
              {formatCryptoVolume(trade.volume)}
            </TableGrid.Cell>
          </TableGrid.Row>
        ))}
        {trades.length === 0 ? (
          <TableGrid.Row placeholder>
            <TableGrid.Cell width="100%" className="muted">
              실시간 체결 내역이 없습니다.
            </TableGrid.Cell>
          </TableGrid.Row>
        ) : null}
      </TableGrid.Body>
    </TableGrid.Root>
  </section>
);
