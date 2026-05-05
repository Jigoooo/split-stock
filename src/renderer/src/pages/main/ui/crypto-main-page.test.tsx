// @vitest-environment jsdom

import { createDefaultCryptoStrategyProfile } from '@shared/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  buildBalanceSummaries,
  CryptoAutoPanel,
  CryptoBalancesPanel,
  CryptoMainPage,
  CryptoOrderbookPanel,
  CryptoTransfersPanel,
} from './crypto-main-page';

const mockMutation = vi.hoisted(() => () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  error: null,
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      crypto: {
        getAutoStatus: { invalidate: vi.fn() },
        getAutoStrategy: { invalidate: vi.fn() },
        getBalances: { invalidate: vi.fn() },
        listAutoStrategyTemplates: { invalidate: vi.fn() },
        listAutoTradeHistory: { invalidate: vi.fn() },
        listAutoWatches: { invalidate: vi.fn() },
        listRecentOrders: { invalidate: vi.fn() },
      },
    }),
    auth: {
      getEnv: { useQuery: () => ({ data: { env: 'PROD' }, isPending: false }) },
    },
    safety: {
      getState: {
        useQuery: () => ({
          data: { master: true, bySymbol: {}, errorLock: { active: false, reason: null } },
          isPending: false,
        }),
      },
    },
    crypto: {
      cancelOrder: { useMutation: mockMutation },
      listClosedLots: {
        useQuery: () => ({ data: { lots: [] }, isPending: false, error: null }),
      },
      getAutoStatus: {
        useQuery: () => ({
          data: {
            config: {
              mode: 'disabled',
              emergencyDisabled: true,
              baseOrderKrw: '5000',
              maxOrderKrw: '5000',
              maxTotalExposureKrw: '50000',
              addTriggerPct: '0.03',
              takeProfitPct: '0.02',
              lastDryRunAt: null,
              lastLiveActionAt: null,
              lastReadonlySmokeAt: null,
            },
            gate: { ok: false, blockedReasons: ['성공한 read-only smoke 기록이 없습니다.'] },
            dryRunLots: [],
            liveLots: [],
            openLots: [],
            recentEvents: [],
            runtimeRunning: false,
          },
        }),
      },
      getAutoStrategy: {
        useQuery: () => ({
          data: { profile: createDefaultCryptoStrategyProfile('KRW-BTC') },
          isFetching: false,
        }),
      },
      getBalances: {
        useQuery: () => ({
          data: {
            balances: [
              {
                currency: 'BTC',
                balance: '0.01',
                locked: '0',
                avgBuyPrice: '100000000',
                unitCurrency: 'KRW',
              },
            ],
          },
        }),
      },
      getOrderDetail: { useQuery: () => ({ data: null, isFetching: false }) },
      getOrderbook: {
        useQuery: () => ({
          data: {
            totalAskSize: '1',
            totalBidSize: '1',
            levels: [{ askPrice: '101', askSize: '1', bidPrice: '100', bidSize: '1' }],
          },
        }),
      },
      getOrderbookInstruments: {
        useQuery: () => ({ data: { entries: [{ market: 'KRW-BTC', tickSize: '1' }] } }),
      },
      getRealtimeStatus: {
        useQuery: () => ({
          data: {
            status: {
              publicSessions: [],
              privateSessions: [{ accountId: 7, state: 'open', lastError: null }],
            },
          },
        }),
      },
      getTicker: {
        useQuery: () => ({
          data: {
            market: 'KRW-BTC',
            tradePrice: '100',
            openingPrice: '98',
            highPrice: '105',
            lowPrice: '95',
            signedChangePrice: '1',
            signedChangeRate: '0.01',
            accTradePrice24h: '1000000000',
            accTradeVolume24h: '10',
          },
        }),
      },
      getTransfer: { useQuery: () => ({ data: null, isFetching: false }) },
      listMarkets: {
        useQuery: () => ({
          data: { entries: [{ market: 'KRW-BTC', koreanName: '비트코인' }] },
        }),
      },
      listAutoWatches: {
        useQuery: () => ({
          data: {
            watches: [
              {
                id: 1,
                accountId: 7,
                exchange: 'UPBIT',
                market: 'KRW-BTC',
                label: null,
                status: 'PAUSED',
                entryCondition: { type: 'immediate', price: null },
                strategy: createDefaultCryptoStrategyProfile('KRW-BTC'),
                config: {
                  accountId: 7,
                  market: 'KRW-BTC',
                  exchange: 'UPBIT',
                  accountEnv: 'PROD',
                  mode: 'disabled',
                  emergencyDisabled: true,
                  baseOrderKrw: '5000',
                  maxOrderKrw: '5000',
                  maxTotalExposureKrw: '50000',
                  minOrderTotalKrw: '5000',
                  addTriggerPct: '0.03',
                  takeProfitPct: '0.02',
                  maxOpenLots: 3,
                  cooldownMs: 60000,
                  staleCancelCap: 3,
                  requireReadOnlySmoke: true,
                  requireDryRunHistoryBeforeLive: true,
                  lastDryRunAt: null,
                  lastReadonlySmokeAt: null,
                  lastLiveActionAt: null,
                  updatedAt: 1,
                },
                currentStage: 0,
                openOrderCount: 0,
                lastDecision: null,
                lastDecisionAt: null,
                lastActionAt: null,
                blockedReasons: ['성공한 read-only smoke 기록이 없습니다.'],
                runtimeRunning: false,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
          isFetching: false,
        }),
      },
      listAutoTradeHistory: {
        useQuery: () => ({
          data: {
            history: [
              {
                id: 1,
                accountId: 7,
                exchange: 'UPBIT',
                market: 'KRW-BTC',
                status: 'failed',
                action: 'config',
                reason: '성공한 read-only smoke 기록이 없습니다.',
                mode: 'disabled',
                createdAt: 1,
              },
            ],
          },
        }),
      },
      listAutoStrategyTemplates: { useQuery: () => ({ data: { templates: [] } }) },
      listRecentOrders: {
        useQuery: () => ({
          data: {
            orders: [
              {
                id: 1,
                uuid: 'done-uuid',
                market: 'KRW-BTC',
                side: 'bid',
                state: 'done',
                price: '100',
                volume: '0.01',
                executedVolume: '0.01',
                remainingVolume: '0',
                paidFee: '1',
              },
              {
                id: 2,
                uuid: 'wait-uuid',
                market: 'KRW-BTC',
                side: 'ask',
                state: 'wait',
                price: '101',
                volume: '0.01',
                executedVolume: '0',
                remainingVolume: '0.01',
                paidFee: '0',
              },
            ],
          },
        }),
      },
      listTransfers: { useQuery: () => ({ data: { transfers: [] } }) },
      listWalletStatuses: { useQuery: () => ({ data: { statuses: [] } }) },
      onOrderbook: { useSubscription: () => ({ data: null, status: 'idle' }) },
      onPrivateAsset: { useSubscription: () => ({ data: null }) },
      onPrivateOrder: { useSubscription: () => ({ data: null }) },
      onTicker: { useSubscription: () => ({ data: null, status: 'idle' }) },
      onTrade: { useSubscription: () => ({ data: null }) },
      placeOrder: { useMutation: mockMutation },
      runAutoDryTick: { useMutation: mockMutation },
      runAutoLiveTick: { useMutation: mockMutation },
      runReadonlySmoke: { useQuery: () => ({ data: null, isFetching: false, refetch: vi.fn() }) },
      createAutoWatch: { useMutation: mockMutation },
      updateAutoWatch: { useMutation: mockMutation },
      pauseAutoWatches: { useMutation: mockMutation },
      resumeAutoWatches: { useMutation: mockMutation },
      deleteAutoWatches: { useMutation: mockMutation },
      saveAutoStrategyTemplate: { useMutation: mockMutation },
      deleteAutoStrategyTemplate: { useMutation: mockMutation },
      saveAutoConfig: { useMutation: mockMutation },
      saveAutoStrategy: { useMutation: mockMutation },
      startAuto: { useMutation: mockMutation },
      stopAuto: { useMutation: mockMutation },
      unwatchMarket: { useMutation: mockMutation },
      unwatchPrivate: { useMutation: mockMutation },
      watchMarket: { useMutation: mockMutation },
      watchPrivate: { useMutation: mockMutation },
    },
  },
}));

vi.mock('./crypto-chart-panel', () => ({
  CryptoChartPanel: ({ market, unit }: { market: string; unit: string }) => (
    <section data-testid="crypto-chart-panel">
      {market} chart {unit}
    </section>
  ),
}));

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children, id }: { children: React.ReactNode; id?: string }) => (
    <div data-panel-id={id}>{children}</div>
  ),
  Separator: () => <div />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));

describe('CryptoMainPage layout', () => {
  it('renders crypto panes inside the shared domestic-stock 3-split structure', () => {
    render(<CryptoMainPage accountId={7} />);

    expect(screen.getByTestId('crypto-main-page')).toBeInTheDocument();
    expect(screen.getByTestId('main-left')).toBeInTheDocument();
    expect(screen.getByTestId('main-right')).toBeInTheDocument();
    expect(screen.getByTestId('main-bottom')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '포지션' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '자동감시' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '비트코인 (KRW-BTC) 매매내역' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '모든 매매내역' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '실시간/상태' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '코인 검색' })).toBeInTheDocument();
    expect(screen.getByTestId('crypto-chart-panel')).toHaveTextContent('D');
    expect(screen.queryByLabelText('마켓 선택')).not.toBeInTheDocument();
    expect(screen.getByLabelText('즉시 주문 티켓')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '매수' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '매도' })).toBeInTheDocument();
  });

  it('switches crypto left pane between holdings subtabs and automation', () => {
    render(<CryptoMainPage accountId={7} />);

    expect(screen.getByRole('tab', { name: '실시간 잔고' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '미체결' }));
    expect(screen.getAllByText('대기').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: '자동감시' }));
    expect(screen.getByRole('tab', { name: '현황' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '실행내역' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '실패' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '히스토리' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ 추가' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '시작' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: '중지' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: '삭제' })[0]).toBeDisabled();
    // '실거래 조건 차단' chip 등 운영 컨트롤은 설정 → 고급/안전 탭으로 이전됨. (RALPLAN P0)
  });

  it('shows stock-like right trade history tabs for crypto automation', () => {
    render(<CryptoMainPage accountId={7} />);

    expect(screen.getByRole('tab', { name: '자동매매 설정' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '전체보기' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '진행중' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '종료' })).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: '불러올 코인 자동매매 템플릿 선택' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '모든 매매내역' }));
    expect(screen.getByText('성공한 read-only smoke 기록이 없습니다.')).toBeInTheDocument();
  });
});

describe('CryptoOrderbookPanel', () => {
  it('shows current price, quantity bars, and pre-fills buy or sell intent from clicked rows', () => {
    const onPickPrice = vi.fn();
    const { container } = render(
      <CryptoOrderbookPanel
        currentPrice="100"
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

    expect(screen.getByText(/현재가 100/)).toBeInTheDocument();
    expect(container.querySelector('.orderbook-row__bar--ask')).toBeInTheDocument();
    expect(container.querySelector('.orderbook-row__bar--bid')).toBeInTheDocument();

    const [askPrice] = screen.getAllByText('101');
    expect(askPrice).toBeDefined();
    fireEvent.click(askPrice as HTMLElement);
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

describe('CryptoBalancesPanel', () => {
  it('formats KRW and tiny asset quantities compactly', () => {
    render(
      <CryptoBalancesPanel
        enabled
        quote="KRW"
        balances={[
          {
            currency: 'KRW',
            unitCurrency: 'KRW',
            available: '91.41778162',
            locked: '0',
            total: '91.41778162',
            avgBuyPrice: '0',
            valuation: '91.41778162',
            costBasis: '0',
            profitLoss: '0',
            profitLossRate: '0',
          },
          {
            currency: 'USDT',
            unitCurrency: 'KRW',
            available: '0.00000022',
            locked: '0',
            total: '0.00000022',
            avgBuyPrice: '1491.99999999',
            valuation: '0',
            costBasis: '0',
            profitLoss: '0',
            profitLossRate: '0',
          },
        ]}
      />,
    );

    expect(screen.getAllByText('91').length).toBeGreaterThan(0);
    expect(screen.getByText('0.000001 미만')).toBeInTheDocument();
    expect(screen.getByText('1,492')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
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

    expect(screen.getByText(/입출금 현황/)).toBeInTheDocument();
    expect(screen.getByText('ETH/ETH working')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '상세' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '입금 요청' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '출금 요청' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '출금 취소' })).not.toBeInTheDocument();
  });
});

describe('CryptoAutoPanel', () => {
  // 운영 컨트롤(mode toggle, blockedReasons chips, "설정 → 고급/안전" hint)은
  // 모두 설정 → 고급/안전 탭으로 이동했다 (RALPLAN U3). main 우측 자동매매 설정
  // 탭은 종목별 strategy 입력만 담당. panel title 우측에 "고급/안전 →" 링크만.
  it('renders strategy form only — operational controls moved to advanced settings', () => {
    render(
      <CryptoAutoPanel
        enabled
        onStrategySave={vi.fn()}
        pending={false}
        strategy={createDefaultCryptoStrategyProfile('KRW-BTC')}
        strategyLoading={false}
      />,
    );

    expect(screen.getByText('자동감시')).toBeInTheDocument();
    expect(screen.getByText('차수별 규칙')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '코인 설정 저장' })).toBeInTheDocument();
    // 고급/안전 빠른 진입 링크는 main 에 존재.
    expect(screen.getByRole('button', { name: '고급/안전 설정 열기' })).toBeInTheDocument();
    // 운영 컨트롤은 main 에서 완전 제거 — 고급/안전 탭에서만.
    expect(screen.queryByRole('button', { name: '소액 실거래 1회' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '루프 시작' })).not.toBeInTheDocument();
    expect(screen.queryByText(/read-only smoke/)).not.toBeInTheDocument();
    expect(screen.queryByText('실거래 차수')).not.toBeInTheDocument();
    // mode toggle 도 제거.
    expect(screen.queryByRole('group', { name: '코인 자동감시 모드' })).not.toBeInTheDocument();
    // blockedReasons chip + hint 텍스트도 제거.
    expect(screen.queryByText(/설정 → 고급\/안전 탭으로 이동했습니다/)).not.toBeInTheDocument();
  });

  it('shows the disabled body when not enabled', () => {
    render(
      <CryptoAutoPanel
        enabled={false}
        onStrategySave={vi.fn()}
        pending={false}
        strategy={createDefaultCryptoStrategyProfile('KRW-BTC')}
        strategyLoading={false}
      />,
    );

    expect(
      screen.getByText('Upbit KRW 실전 계좌와 KRW 마켓에서만 동작합니다.'),
    ).toBeInTheDocument();
  });
});
