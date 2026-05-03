import type { CryptoTradeCycle } from '@renderer/entities/account-crypto';
import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { formatCryptoAmount, formatCryptoPrice, formatCryptoVolume } from '../model/crypto-format';
import { formatDateTime, formatPercent } from '../model/crypto-formatters';

/**
 * 코인 매매 사이클 패널 — 닫힌 차수(매수→매도 완결)의 P&L 표시. (RALPLAN P6 A6)
 */
export const CryptoCyclesPanel = ({
  enabled,
  market,
  cycles,
  quote,
}: {
  enabled: boolean;
  market: string;
  cycles: CryptoTradeCycle[];
  quote: string;
}): ReactElement => (
  <section className="panel crypto-account-panel">
    <div className="panel__title">매매 사이클 ({market})</div>
    {!enabled ? (
      <div className="panel__body muted">활성 Upbit 실전 계좌에서만 조회됩니다.</div>
    ) : (
      <TableGrid.Root variant="hts" stickyHeader horizontalScroll style={{ height: '100%' }}>
        <TableGrid.Header>
          <TableGrid.Cell width="4rem">차수</TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            평단
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            매입금액
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            실현손익
          </TableGrid.Cell>
          <TableGrid.Cell width="11rem">매수→매도</TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {cycles.map((cycle) => (
            <TableGrid.Row key={cycle.id}>
              <TableGrid.Cell width="4rem">
                <strong>#{cycle.nth}</strong>
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoPrice(cycle.buyPrice, market)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoVolume(cycle.qty)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoAmount(cycle.amountKrw, quote)}
              </TableGrid.Cell>
              <TableGrid.Cell
                flex={1}
                numeric
                className={
                  cycle.realizedPnl < 0 ? 'num-down' : cycle.realizedPnl > 0 ? 'num-up' : 'muted'
                }
              >
                {formatCryptoAmount(cycle.realizedPnl, quote)} /{' '}
                {formatPercent(String(cycle.pnlRate))}
              </TableGrid.Cell>
              <TableGrid.Cell width="11rem" className="muted">
                {formatDateTime(cycle.openedAt)} → {formatDateTime(cycle.closedAt)}
              </TableGrid.Cell>
            </TableGrid.Row>
          ))}
          {cycles.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell width="100%" className="muted">
                완료된 매매 사이클이 없습니다.
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
        </TableGrid.Body>
      </TableGrid.Root>
    )}
  </section>
);
