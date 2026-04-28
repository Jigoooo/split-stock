// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RecommendedItem } from '../model/use-symbol-recommendations';
import { RecommendCard } from './recommend-card';

function baseItem(overrides: Partial<RecommendedItem> = {}): RecommendedItem {
  return {
    pdno: '005930',
    name: '삼성전자',
    score: 72,
    tier: 'strong',
    confidence: 'med',
    volatilityFit: 'mid',
    liquidityFit: 'good',
    summary: '알고리즘 신호와 뉴스가 중립 이상입니다.',
    pros: [],
    cons: [],
    entryNote: null,
    consensusCount: 3,
    citedTools: [],
    sources: ['AUTO'],
    stats: {
      lastClose: 72100,
      volatility60d: 18.2,
      avgVolume60d: 12000000,
      rangePct120d: 24.5,
    },
    marketContext: null,
    algoScore: 74,
    algoLabels: [],
    aiOff: false,
    news: [],
    conflicts: [],
    indicatorReasons: [],
    ...overrides,
  };
}

describe('RecommendCard market context', () => {
  it('marketContext 가 없어도 consensusCount 3 표시와 상세 펼침이 유지된다', () => {
    render(<RecommendCard item={baseItem({ marketContext: null })} onPick={vi.fn()} />);

    expect(screen.getByText('합의 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /상세 보기/ }));

    expect(screen.getByText('최근 종가')).toBeInTheDocument();
    expect(screen.queryByText('KRX 종가')).not.toBeInTheDocument();
  });

  it('KRX/ECOS 캐시 컨텍스트를 별도 상세 정보로 표시한다', () => {
    render(
      <RecommendCard
        item={baseItem({
          marketContext: {
            krx: {
              date: '2026-04-28',
              close: 72100,
              changeRate: -0.41,
              volume: 12345678,
              tradeValue: 890000000000,
              marketCap: 430000000000000,
            },
            ecos: [{ indicator: 'usdKrw', date: '20260428', value: 1381.2, unitName: '원' }],
            status: {
              krx: { isAvailable: true, isStale: false, lastError: null },
              ecos: { isAvailable: true, isStale: false, lastError: null },
            },
          },
        })}
        onPick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /상세 보기/ }));

    expect(screen.getByText('KRX 종가')).toBeInTheDocument();
    expect(screen.getByText('72,100원 (2026-04-28)')).toBeInTheDocument();
    expect(screen.getByText('KRX 시가총액')).toBeInTheDocument();
    expect(screen.getByText('430.0조원')).toBeInTheDocument();
    expect(screen.getByText('ECOS USD/KRW')).toBeInTheDocument();
    expect(screen.getByText('1,381.2원 (20260428)')).toBeInTheDocument();
  });
});
