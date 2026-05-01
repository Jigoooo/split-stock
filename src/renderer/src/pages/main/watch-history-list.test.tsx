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
    expect(screen.getByText(/2026년 .*월 .*일/)).toBeInTheDocument();
    expect(screen.getByText('등록')).toBeInTheDocument();
    expect(screen.getByText('삼성전자')).toBeInTheDocument();
    expect(screen.getByText('005930')).toBeInTheDocument();
    expect(screen.getByText('#33')).toBeInTheDocument();
    expect(screen.getByText('테스트 사유')).toBeInTheDocument();
  });
});
