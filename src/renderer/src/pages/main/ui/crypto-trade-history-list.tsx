import {
  type CryptoTradeCycle,
  useCryptoBalanceWithLots,
  useCryptoTradeCycles,
} from '@renderer/entities/account-crypto';
import { formatDateOnly } from '@renderer/shared/lib/formatter';
import { TableGrid } from '@renderer/shared/ui';
import { BROKERS, LOT_STATUS, type LotStatus, normalizeLotStatus } from '@shared/contracts';
import type { ReactElement } from 'react';
import { formatCryptoPrice, formatCryptoVolume, getCryptoQuote } from '../model/crypto-format';

/**
 * 코인 매매내역 리스트 — stock TradeHistoryList 와 컬럼 set 100% 동등.
 *
 * 표시 컬럼: 차수 / 종목 / 매수가 / 수량 / 매도가 / 손익 / 수익률 / 상태 / 매수일 / 매도일
 *
 * status 필터:
 *  - open   : 진행중 (open/reducing) lots — useCryptoBalanceWithLots.lots
 *  - closed : 종료 (closed) lots — useCryptoTradeCycles.cycles
 *  - all    : open + closed 모두
 *
 * 종목 컬럼은 market = null (전체 보기) 시만 노출 — stock 동등.
 */

export type CryptoTradeHistoryStatus = 'all' | 'open' | 'closed';

export interface CryptoTradeHistoryListProps {
  accountId: number;
  market: string | null;
  status: CryptoTradeHistoryStatus;
}

const TRADE_HISTORY_COLS = {
  nth: '5.2rem',
  symbol: '17.6rem',
  buyPrice: '9.6rem',
  qty: '8.4rem',
  sellPrice: '9.6rem',
  pnl: '10.4rem',
  pnlRate: '8.8rem',
  status: '8.8rem',
  boughtAt: '11.6rem',
  soldAt: '11.6rem',
} as const;

interface CryptoTradeRow {
  id: string;
  nth: number;
  market: string;
  buyPrice: number;
  qty: number;
  sellPrice: number | undefined;
  pnl: number | undefined;
  pnlRate: number | undefined;
  status: LotStatus;
  boughtAt: number;
  soldAt: number | undefined;
}

/** crypto cycle (closed) → 공통 row. */
function fromClosed(cycle: CryptoTradeCycle, market: string): CryptoTradeRow {
  const sellPrice = cycle.qty > 0 ? cycle.buyPrice + cycle.realizedPnl / cycle.qty : undefined;
  return {
    id: `closed-${cycle.id}`,
    nth: cycle.nth,
    market,
    buyPrice: cycle.buyPrice,
    qty: cycle.qty,
    sellPrice,
    pnl: cycle.realizedPnl,
    pnlRate: cycle.pnlRate * 100,
    status: LOT_STATUS.SOLD,
    boughtAt: cycle.openedAt,
    soldAt: cycle.closedAt ?? undefined,
  };
}

/** crypto open lot → 공통 row. */
function fromOpen(
  lot: { nth: number; buyPrice: number; qty: number; status: string; boughtAt: number },
  market: string,
): CryptoTradeRow {
  return {
    id: `open-${market}-${lot.nth}`,
    nth: lot.nth,
    market,
    buyPrice: lot.buyPrice,
    qty: lot.qty,
    sellPrice: undefined,
    pnl: undefined,
    pnlRate: undefined,
    status: normalizeLotStatus(BROKERS.UPBIT, lot.status),
    boughtAt: lot.boughtAt,
    soldAt: undefined,
  };
}

export const CryptoTradeHistoryList = (props: CryptoTradeHistoryListProps): ReactElement => {
  const { accountId, market, status } = props;
  // market === null (전체보기) 케이스는 현재 미구현 — closed lots 는 단일 market 만 fetch.
  // 우선 market 미선택 시 종목 컬럼 노출 + 빈 상태 표시.
  const targetMarket = market ?? '';
  const showSymbolColumn = market === null;

  const cycles = useCryptoTradeCycles(accountId, targetMarket);
  const balanceWithLots = useCryptoBalanceWithLots(accountId, targetMarket);

  const rows: CryptoTradeRow[] = [];
  if (status === 'all' || status === 'open') {
    for (const lot of balanceWithLots.lots) {
      if (lot.status === 'closed') continue;
      rows.push(fromOpen(lot, targetMarket));
    }
  }
  if (status === 'all' || status === 'closed') {
    for (const cycle of cycles.cycles) {
      rows.push(fromClosed(cycle, targetMarket));
    }
  }
  // 차수 오름 + 매수일 내림으로 정렬 — 사용자 인지 일관성.
  rows.sort((a, b) => b.boughtAt - a.boughtAt || a.nth - b.nth);

  const isPending = cycles.isPending && status !== 'open';
  const error = cycles.error;
  const quote = market !== null ? getCryptoQuote(market) : 'KRW';

  return (
    <TableGrid.Root
      variant="hts"
      stickyHeader
      horizontalScroll
      aria-label={market ? `${market} 매매 사이클` : '전체 코인 매매 사이클'}
      style={{ flex: 1, minHeight: 0 }}
    >
      {error ? (
        <div className="chip chip--down" role="alert" style={{ margin: '0.5rem' }}>
          {error.message}
        </div>
      ) : null}
      <TableGrid.Header>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.nth} numeric>
          차수
        </TableGrid.Cell>
        {showSymbolColumn ? (
          <TableGrid.Cell width={TRADE_HISTORY_COLS.symbol}>종목</TableGrid.Cell>
        ) : null}
        <TableGrid.Cell width={TRADE_HISTORY_COLS.buyPrice} numeric>
          매수가
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.qty} numeric>
          수량
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.sellPrice} numeric>
          매도가
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.pnl} numeric>
          손익
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.pnlRate} numeric>
          수익률
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.status}>상태</TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.boughtAt} className="muted date-time-cell">
          매수일
        </TableGrid.Cell>
        <TableGrid.Cell width={TRADE_HISTORY_COLS.soldAt} className="muted date-time-cell">
          매도일
        </TableGrid.Cell>
      </TableGrid.Header>
      <TableGrid.Body>
        {isPending ? (
          <TableGrid.Row placeholder>
            <TableGrid.Cell className="muted">로드 중…</TableGrid.Cell>
          </TableGrid.Row>
        ) : rows.length === 0 ? (
          <TableGrid.Row placeholder>
            <TableGrid.Cell className="muted">사이클 없음</TableGrid.Cell>
          </TableGrid.Row>
        ) : (
          rows.map((row) => {
            const sign =
              row.pnl === undefined ? 'flat' : row.pnl > 0 ? 'up' : row.pnl < 0 ? 'down' : 'flat';
            const cls = sign === 'up' ? 'num-up' : sign === 'down' ? 'num-down' : 'num-flat';
            return (
              <TableGrid.Row key={row.id}>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.nth} numeric>
                  {row.nth}차
                </TableGrid.Cell>
                {showSymbolColumn ? (
                  <TableGrid.Cell width={TRADE_HISTORY_COLS.symbol}>{row.market}</TableGrid.Cell>
                ) : null}
                <TableGrid.Cell width={TRADE_HISTORY_COLS.buyPrice} numeric>
                  {formatCryptoPrice(row.buyPrice, row.market)}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.qty} numeric>
                  {formatCryptoVolume(row.qty)}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.sellPrice} numeric>
                  {row.sellPrice !== undefined ? formatCryptoPrice(row.sellPrice, row.market) : '-'}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.pnl} numeric className={cls}>
                  {row.pnl !== undefined ? formatSignedKrw(row.pnl, quote) : '-'}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.pnlRate} numeric className={cls}>
                  {row.pnlRate !== undefined ? `${row.pnlRate.toFixed(2)}%` : '-'}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.status}>{row.status}</TableGrid.Cell>
                <TableGrid.Cell
                  width={TRADE_HISTORY_COLS.boughtAt}
                  className="muted date-time-cell"
                >
                  {formatDateOnly(row.boughtAt)}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_HISTORY_COLS.soldAt} className="muted date-time-cell">
                  {row.soldAt !== undefined ? formatDateOnly(row.soldAt) : '-'}
                </TableGrid.Cell>
              </TableGrid.Row>
            );
          })
        )}
      </TableGrid.Body>
    </TableGrid.Root>
  );
};

function formatSignedKrw(value: number, quote: string): string {
  const sign = value > 0 ? '+' : '';
  const rounded = quote === 'KRW' ? Math.round(value) : value;
  return `${sign}${rounded.toLocaleString('ko-KR')}`;
}
