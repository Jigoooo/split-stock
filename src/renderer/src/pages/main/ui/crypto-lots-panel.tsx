import type { CryptoLotEntry } from '@renderer/entities/account-crypto';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
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
  <section
    className="panel crypto-account-panel"
    style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
    }}
    aria-label={`차수별 잔고 (${market})`}
  >
    <div className="panel__title" style={{ flexShrink: 0 }}>
      차수별 잔고 ({market}) · {thousandSeparator(lots.length)}차수
    </div>
    {!enabled ? (
      <div className="panel__body muted">활성 Upbit 실전 계좌에서만 조회됩니다.</div>
    ) : (
      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label="차수별 잔고 테이블"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width="5.6rem" numeric>
            차수
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            매입가
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
            평가손익
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {lots.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell width="100%" className="muted">
                보유 차수가 없습니다.
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
          {lots.map((lot) => {
            const evalAmount = lot.qty * currentPrice;
            const pnl = evalAmount - lot.amountKrw;
            const pnlRate = lot.amountKrw > 0 ? pnl / lot.amountKrw : 0;
            return (
              <TableGrid.Row key={lot.nth}>
                <TableGrid.Cell width="5.6rem" numeric>
                  <strong>{lot.nth}차</strong>
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
        </TableGrid.Body>
      </TableGrid.Root>
    )}
  </section>
);
