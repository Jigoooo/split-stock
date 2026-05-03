import type { CryptoLotEntry } from '@renderer/entities/account-crypto';
import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { formatCryptoAmount, formatCryptoPrice, formatCryptoVolume } from '../model/crypto-format';
import { formatPercent } from '../model/crypto-formatters';

/**
 * 코인 차수별 잔고 패널 — 국내주식 차수 grid와 시각 정렬. (RALPLAN P6 A0)
 *
 * 매직스플릿 차수 전략(직전차수 하향매수, 차수별 독립 익절)의 결과를 nth(차수)
 * 단위로 표시. status='open' lot만 표시, 익절 완료된 lot은 사라진다.
 */
export const CryptoLotsPanel = ({
  enabled,
  market,
  lots,
  currentPrice,
  quote,
}: {
  enabled: boolean;
  market: string;
  lots: CryptoLotEntry[];
  currentPrice: number;
  quote: string;
}): ReactElement => (
  <section className="panel crypto-account-panel">
    <div className="panel__title">차수별 잔고 ({market})</div>
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
            평가금액
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            손익
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {lots.map((lot) => {
            const evalAmount = lot.qty * currentPrice;
            const pnl = evalAmount - lot.amountKrw;
            const pnlRate = lot.amountKrw > 0 ? pnl / lot.amountKrw : 0;
            return (
              <TableGrid.Row key={lot.nth}>
                <TableGrid.Cell width="4rem">
                  <strong>#{lot.nth}</strong>
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  {formatCryptoPrice(lot.buyPrice, market)}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  {formatCryptoVolume(lot.qty)}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  {formatCryptoAmount(lot.amountKrw, quote)}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  {formatCryptoAmount(evalAmount, quote)}
                </TableGrid.Cell>
                <TableGrid.Cell
                  flex={1}
                  numeric
                  className={pnl < 0 ? 'num-down' : pnl > 0 ? 'num-up' : 'muted'}
                >
                  {formatCryptoAmount(pnl, quote)} / {formatPercent(String(pnlRate))}
                </TableGrid.Cell>
              </TableGrid.Row>
            );
          })}
          {lots.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell width="100%" className="muted">
                보유 차수가 없습니다.
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
        </TableGrid.Body>
      </TableGrid.Root>
    )}
  </section>
);
