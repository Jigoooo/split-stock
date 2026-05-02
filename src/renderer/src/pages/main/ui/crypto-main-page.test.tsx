// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  buildBalanceSummaries,
  CryptoOrderbookPanel,
  CryptoTransfersPanel,
} from './crypto-main-page';

describe('CryptoOrderbookPanel', () => {
  it('shows current price, quantity bars, and pre-fills buy or sell intent from clicked rows', () => {
    const onPickPrice = vi.fn();
    const { container } = render(
      <CryptoOrderbookPanel
        currentPrice="100.5"
        market="KRW-BTC"
        onPickPrice={onPickPrice}
        orderbook={{
          totalAskSize: '2.5',
          totalBidSize: '3.5',
          levels: [
            { askPrice: '101', askSize: '1.25', bidPrice: '100', bidSize: '2.5' },
            { askPrice: '102', askSize: '0.25', bidPrice: '99', bidSize: '1' },
          ],
        }}
      />,
    );

    expect(screen.getByText('현재가')).toBeInTheDocument();
    expect(container.querySelector('.orderbook-row__bar--ask')).toBeInTheDocument();
    expect(container.querySelector('.orderbook-row__bar--bid')).toBeInTheDocument();

    fireEvent.click(screen.getByText('101'));
    fireEvent.click(screen.getByText('99'));

    expect(onPickPrice).toHaveBeenNthCalledWith(1, '101', 'bid');
    expect(onPickPrice).toHaveBeenNthCalledWith(2, '99', 'ask');
  });
});

describe('buildBalanceSummaries', () => {
  it('keeps decimal balance math for valuation, PnL, and locked totals', () => {
    const [summary] = buildBalanceSummaries({
      market: 'KRW-BTC',
      tradePrice: '120.5',
      balances: [
        {
          currency: 'BTC',
          balance: '0.1',
          locked: '0.02',
          avgBuyPrice: '100',
          unitCurrency: 'KRW',
        },
      ],
    });

    expect(summary).toMatchObject({
      total: '0.12',
      valuation: '14.46',
      costBasis: '12',
      profitLoss: '2.46',
      profitLossRate: '0.205',
    });
  });
});

describe('CryptoTransfersPanel', () => {
  it('renders read-only transfer and wallet status without execution controls', () => {
    render(
      <CryptoTransfersPanel
        enabled
        onCloseDetail={vi.fn()}
        onOpenDetail={vi.fn()}
        selectedTransfer={null}
        transferDetailLoading={false}
        transfers={[
          {
            direction: 'withdraw',
            uuid: 'withdraw-uuid',
            currency: 'ETH',
            amount: '1.25',
            fee: '0.01',
            state: 'DONE',
            txid: 'txid',
            transactionType: 'default',
            transferType: 'withdraw',
            netType: 'ETH',
            createdAt: 1,
            doneAt: 2,
            isCancelable: false,
          },
        ]}
        walletStatuses={[
          {
            currency: 'ETH',
            netType: 'ETH',
            networkName: 'Ethereum',
            walletState: 'working',
            blockElapsedMinutes: 1,
            blockHeight: 1,
            blockState: 'normal',
            blockUpdatedAt: 1,
          },
        ]}
      />,
    );

    expect(screen.getByText('입출금 현황')).toBeInTheDocument();
    expect(screen.getByText('ETH/ETH working')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '입금 요청' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '출금 요청' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '출금 취소' })).not.toBeInTheDocument();
  });
});
