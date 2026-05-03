// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CryptoAdvancedSettingsSection } from './crypto-advanced-settings-section';

const mockMutation = vi.hoisted(() => () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  error: null,
}));

type CryptoMode = 'disabled' | 'dry-run' | 'live-small';

const trpcState = vi.hoisted(
  (): {
    watches: Array<{ id: number; accountId: number; market: string }>;
    status: {
      config: {
        mode: 'disabled' | 'dry-run' | 'live-small';
        emergencyDisabled: boolean;
        maxOrderKrw: string;
        maxTotalExposureKrw: string;
        lastDryRunAt: number | null;
        lastLiveActionAt: number | null;
        lastReadonlySmokeAt: number | null;
      };
      gate: { ok: boolean; blockedReasons: string[] };
      runtimeRunning: boolean;
      liveLots: never[];
      recentEvents: never[];
      openLots: never[];
      dryRunLots: never[];
    };
  } => ({
    watches: [{ id: 1, accountId: 7, market: 'KRW-BTC' }],
    status: {
      config: {
        mode: 'disabled',
        emergencyDisabled: false,
        maxOrderKrw: '5000',
        maxTotalExposureKrw: '50000',
        lastDryRunAt: null,
        lastLiveActionAt: null,
        lastReadonlySmokeAt: null,
      },
      gate: { ok: false, blockedReasons: ['성공한 read-only smoke 기록이 없습니다.'] },
      runtimeRunning: false,
      liveLots: [],
      recentEvents: [],
      openLots: [],
      dryRunLots: [],
    },
  }),
);

void ({} as CryptoMode);

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      crypto: {
        getAutoStatus: { invalidate: vi.fn() },
      },
    }),
    account: {
      getActive: {
        useQuery: () => ({
          data: { accountId: 7, account: { id: 7, broker: 'UPBIT' } },
          isPending: false,
        }),
      },
    },
    crypto: {
      listAutoWatches: {
        useQuery: () => ({ data: { watches: trpcState.watches }, isPending: false }),
      },
      getAutoStatus: {
        useQuery: () => ({ data: trpcState.status, isPending: false }),
      },
      saveAutoConfig: { useMutation: mockMutation },
      runAutoLiveTick: { useMutation: mockMutation },
      startAuto: { useMutation: mockMutation },
      stopAuto: { useMutation: mockMutation },
    },
  },
}));

describe('CryptoAdvancedSettingsSection', () => {
  it('shows empty-state message when no crypto watches are registered', () => {
    const original = trpcState.watches;
    trpcState.watches = [];
    try {
      render(<CryptoAdvancedSettingsSection />);
      expect(
        screen.getByText(
          '등록된 코인 자동감시가 없습니다. 메인 화면에서 자동감시를 먼저 추가하세요.',
        ),
      ).toBeInTheDocument();
    } finally {
      trpcState.watches = original;
    }
  });

  it('renders all operational controls when at least one watch exists', () => {
    render(<CryptoAdvancedSettingsSection />);

    expect(screen.getByLabelText('고급 설정 대상 마켓')).toBeInTheDocument();
    expect(screen.getByLabelText('주문당 상한')).toBeInTheDocument();
    expect(screen.getByLabelText('총 노출 상한')).toBeInTheDocument();
    const matchSpan = (prefix: string) => (_: string, el: Element | null) =>
      el?.tagName === 'SPAN' && (el.textContent ?? '').startsWith(prefix);
    expect(screen.getByText(matchSpan('read-only smoke'))).toBeInTheDocument();
    expect(screen.getByText(matchSpan('마지막 내부 검증'))).toBeInTheDocument();
    expect(screen.getByText(matchSpan('마지막 실거래 실행'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보호 설정 저장' })).toBeInTheDocument();
    expect(screen.getByText('실거래 차수')).toBeInTheDocument();
    expect(screen.getByText('최근 판단')).toBeInTheDocument();
    expect(screen.getByText('실거래 차수 없음')).toBeInTheDocument();
    expect(screen.getByText('판단 이력 없음')).toBeInTheDocument();
  });

  it('disables 소액 실거래 1회 when gate is blocked', () => {
    render(<CryptoAdvancedSettingsSection />);

    expect(screen.getByRole('button', { name: '소액 실거래 1회' })).toBeDisabled();
  });

  it('disables 루프 시작 when in live-small mode and gate blocked', () => {
    const original = trpcState.status.config.mode;
    trpcState.status.config.mode = 'live-small';
    try {
      render(<CryptoAdvancedSettingsSection />);
      expect(screen.getByRole('button', { name: '루프 시작' })).toBeDisabled();
    } finally {
      trpcState.status.config.mode = original;
    }
  });

  it('disables 루프 중지 when not currently running', () => {
    render(<CryptoAdvancedSettingsSection />);

    expect(screen.getByRole('button', { name: '루프 중지' })).toBeDisabled();
  });

  it('shows blocked reasons as down chips', () => {
    render(<CryptoAdvancedSettingsSection />);

    expect(screen.getByText('성공한 read-only smoke 기록이 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('실거래 조건 차단')).toBeInTheDocument();
  });
});
