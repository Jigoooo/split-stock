// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  buildBalanceSummaries,
  CryptoAutoPanel,
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

describe('CryptoAutoPanel', () => {
  it('shows dry-run/live gate state, lots, events, and disables live when blocked', () => {
    render(
      <CryptoAutoPanel
        addTriggerPct="0.03"
        baseOrderKrw="5000"
        emergencyDisabled
        enabled
        events={[
          {
            id: 1,
            accountId: 1,
            exchange: 'UPBIT',
            market: 'KRW-BTC',
            mode: 'dry-run',
            kind: 'dry-run',
            action: 'plan-buy',
            reason: 'dry-run simulated',
            intent: null,
            result: null,
            idempotencyKey: null,
            createdAt: 1,
          },
        ]}
        gate={{ ok: false, blockedReasons: ['비상 중지 상태입니다.'] }}
        dryRunLots={[
          {
            id: 1,
            accountId: 1,
            exchange: 'UPBIT',
            market: 'KRW-BTC',
            source: 'dry-run',
            sequence: 1,
            quantity: '0.00005',
            avgEntryKrw: '100000000',
            allocatedKrw: '5000',
            realizedPnl: '0',
            feesPaid: '0',
            status: 'open',
            openedAt: 1,
            closedAt: null,
            updatedAt: 1,
          },
        ]}
        lastDryRunAt={2}
        lastLiveActionAt={null}
        lastReadonlySmokeAt={1}
        liveLots={[]}
        market="KRW-BTC"
        maxExposureKrw="50000"
        maxOrderKrw="5000"
        mode="dry-run"
        onAddTriggerPctChange={vi.fn()}
        onBaseOrderKrwChange={vi.fn()}
        onEmergencyDisabledChange={vi.fn()}
        onMaxExposureKrwChange={vi.fn()}
        onMaxOrderKrwChange={vi.fn()}
        onModeChange={vi.fn()}
        onRunDry={vi.fn()}
        onRunLive={vi.fn()}
        onSave={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onTakeProfitPctChange={vi.fn()}
        pending={false}
        quote="KRW"
        running={false}
        takeProfitPct="0.02"
      />,
    );

    expect(screen.getByText('자동매매')).toBeInTheDocument();
    expect(screen.getByText(/read-only smoke/)).toBeInTheDocument();
    expect(screen.getByText(/마지막 dry-run/)).toBeInTheDocument();
    expect(screen.getByText(/마지막 live action/)).toBeInTheDocument();
    expect(screen.getByText('live gate 차단')).toBeInTheDocument();
    expect(screen.getByText('비상 중지 상태입니다.')).toBeInTheDocument();
    expect(screen.getByText('Dry-run lots')).toBeInTheDocument();
    expect(screen.getByText('Live lots')).toBeInTheDocument();
    expect(screen.getByText(/#1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'live-small 1회' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'dry-run 1회' })).toBeEnabled();
  });

  it('disables loop start for live-small while the gate is blocked', () => {
    render(
      <CryptoAutoPanel
        addTriggerPct="0.03"
        baseOrderKrw="5000"
        dryRunLots={[]}
        emergencyDisabled
        enabled
        events={[]}
        gate={{ ok: false, blockedReasons: ['성공한 read-only smoke 기록이 없습니다.'] }}
        lastDryRunAt={null}
        lastLiveActionAt={null}
        lastReadonlySmokeAt={null}
        liveLots={[]}
        market="KRW-BTC"
        maxExposureKrw="50000"
        maxOrderKrw="5000"
        mode="live-small"
        onAddTriggerPctChange={vi.fn()}
        onBaseOrderKrwChange={vi.fn()}
        onEmergencyDisabledChange={vi.fn()}
        onMaxExposureKrwChange={vi.fn()}
        onMaxOrderKrwChange={vi.fn()}
        onModeChange={vi.fn()}
        onRunDry={vi.fn()}
        onRunLive={vi.fn()}
        onSave={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onTakeProfitPctChange={vi.fn()}
        pending={false}
        quote="KRW"
        running={false}
        takeProfitPct="0.02"
      />,
    );

    expect(screen.getByRole('button', { name: 'loop 시작' })).toBeDisabled();
  });
});
