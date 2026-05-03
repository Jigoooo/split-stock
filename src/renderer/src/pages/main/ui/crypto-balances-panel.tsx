import { TableGrid } from '@renderer/shared/ui';
import type { CryptoBalanceSummary } from '@shared/contracts';
import type { ReactElement } from 'react';
import { formatCryptoAmount, formatCryptoDecimal } from '../model/crypto-format';
import { formatPercent } from '../model/crypto-formatters';

export const CryptoBalancesPanel = ({
  balances,
  enabled,
  quote,
}: {
  balances: CryptoBalanceSummary[];
  enabled: boolean;
  quote: string;
}): ReactElement => (
  <section className="panel crypto-account-panel">
    <div className="panel__title">실시간 잔고</div>
    {!enabled ? (
      <div className="panel__body muted">활성 Upbit 실전 계좌에서만 조회됩니다.</div>
    ) : (
      <TableGrid.Root variant="hts" stickyHeader horizontalScroll style={{ height: '100%' }}>
        <TableGrid.Header>
          <TableGrid.Cell width="7rem">자산</TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            주문가능
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            잠김
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            평단
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            평가
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            손익
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {balances.map((balance) => (
            <TableGrid.Row key={balance.currency}>
              <TableGrid.Cell width="7rem">{balance.currency}</TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatBalanceQuantity(balance.available, balance.currency, quote)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatBalanceQuantity(balance.locked, balance.currency, quote)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoAmount(balance.avgBuyPrice, quote)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoAmount(balance.valuation, quote)}
              </TableGrid.Cell>
              <TableGrid.Cell
                flex={1}
                numeric
                className={
                  hasMeaningfulBalanceProfitLoss(balance, quote)
                    ? Number(balance.profitLoss) < 0
                      ? 'num-down'
                      : 'num-up'
                    : 'muted'
                }
              >
                {formatBalanceProfitLoss(balance, quote)}
              </TableGrid.Cell>
            </TableGrid.Row>
          ))}
          {balances.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell width="100%" className="muted">
                조회된 실시간 잔고가 없습니다.
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
        </TableGrid.Body>
      </TableGrid.Root>
    )}
  </section>
);

function hasMeaningfulBalanceProfitLoss(balance: CryptoBalanceSummary, quote: string): boolean {
  if (balance.currency === quote) return false;
  const costBasis = Number(balance.costBasis);
  const valuation = Number(balance.valuation);
  return Number.isFinite(costBasis) && costBasis > 0 && Number.isFinite(valuation);
}

function formatBalanceProfitLoss(balance: CryptoBalanceSummary, quote: string): string {
  if (!hasMeaningfulBalanceProfitLoss(balance, quote)) return '-';
  return `${formatCryptoAmount(balance.profitLoss, quote)} / ${formatPercent(
    balance.profitLossRate,
  )}`;
}

function formatBalanceQuantity(
  value: string | number | undefined,
  currency: string,
  quote: string,
): string {
  if (currency === quote) return formatCryptoAmount(value, quote);
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '-';
  const abs = Math.abs(numeric);
  if (abs === 0) return '0';
  if (abs < 0.000001) return '0.000001 미만';
  if (abs >= 1) return formatCryptoDecimal(value, { maxFractionDigits: 4 });
  return formatCryptoDecimal(value, { maxFractionDigits: 6 });
}
