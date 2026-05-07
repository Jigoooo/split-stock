// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WatchHistoryList } from './ui/watch-history-list';

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    market: {
      listAllStock: {
        useQuery: () => ({
          data: {
            entries: [{ pdno: '005930', name: '삼성전자', sector: '전기전자' }],
          },
        }),
      },
    },
  },
}));

describe('WatchHistoryList', () => {
  it('종목 마스터로 히스토리 종목명을 보강하고 상세 정보를 표시한다', () => {
    render(
      <WatchHistoryList
        isPending={false}
        error={null}
        items={[
          {
            id: 10,
            at: new Date('2026-04-25T01:02:03Z'),
            level: 'INFO',
            message: 'watch.created',
            accountId: 1,
            pdno: '005930',
            source: 'CUSTOM',
            watchId: 33,
            reason: '테스트 사유',
          },
        ]}
      />,
    );

    expect(screen.getByRole('region', { name: '자동감시 히스토리' })).toBeInTheDocument();
    expect(screen.getByText('시각')).toBeInTheDocument();
    expect(screen.getByText('레벨')).toBeInTheDocument();
    expect(screen.getByText('이벤트')).toBeInTheDocument();
    expect(document.querySelector('article')).not.toBeInTheDocument();
    const timeCell = screen.getByText(/2026\.04\.25 \d{2}:\d{2}:\d{2}/);
    expect(timeCell).toBeInTheDocument();
    expect(timeCell.getAttribute('title')).toMatch(/2026년 4월 25일/);
    expect(screen.getByText('등록')).toBeInTheDocument();
    expect(screen.getByText('삼성전자 (005930)')).toBeInTheDocument();
    expect(screen.getByText('#33')).toBeInTheDocument();
    expect(screen.getByText('테스트 사유')).toBeInTheDocument();
  });

  it('코인 자동매매 이벤트를 한국어 라벨과 "코인 자동매매" 출처로 표시한다', () => {
    render(
      <WatchHistoryList
        isPending={false}
        error={null}
        items={[
          {
            id: 20,
            at: new Date('2026-05-01T10:00:00Z'),
            level: 'INFO',
            message: 'auto-crypto.live-place.plan-buy',
            accountId: 1,
            pdno: 'KRW-BTC',
            source: 'CUSTOM',
            watchId: null,
            reason: '매수 조건 충족',
          },
          {
            id: 21,
            at: new Date('2026-05-01T11:00:00Z'),
            level: 'WARN',
            message: 'auto-crypto.blocked.plan-sell',
            accountId: 1,
            pdno: 'KRW-ETH',
            source: 'CUSTOM',
            watchId: null,
            reason: '잔고 부족',
          },
        ]}
      />,
    );

    expect(screen.getByText('실거래 매수')).toBeInTheDocument();
    expect(screen.getByText('매도 차단')).toBeInTheDocument();
    // source='CUSTOM' + auto-crypto.* message → '코인 자동매매' (예약매수 아님)
    expect(screen.getAllByText('코인 자동매매')).toHaveLength(2);
    expect(screen.queryByText('예약매수')).not.toBeInTheDocument();
  });

  it('도메스틱 CUSTOM source 는 여전히 "예약매수" 로 표시한다', () => {
    render(
      <WatchHistoryList
        isPending={false}
        error={null}
        items={[
          {
            id: 30,
            at: new Date('2026-05-01T12:00:00Z'),
            level: 'INFO',
            message: 'watch.executed',
            accountId: 1,
            pdno: '005930',
            source: 'CUSTOM',
            watchId: 99,
            reason: null,
          },
        ]}
      />,
    );

    expect(screen.getByText('실행')).toBeInTheDocument();
    expect(screen.getByText('예약매수')).toBeInTheDocument();
  });
});
