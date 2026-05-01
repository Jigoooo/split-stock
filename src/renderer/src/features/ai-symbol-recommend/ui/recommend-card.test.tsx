// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RecommendedItem } from '../model/use-symbol-recommendations';
import { RecommendCard, RecommendDetail } from './recommend-card';

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
  it('master 리스트 카드에서 consensusCount 를 표시하고 선택 콜백을 호출한다', () => {
    const onSelect = vi.fn();
    render(
      <RecommendCard
        item={baseItem({ marketContext: null })}
        onPick={vi.fn()}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('합의 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /삼성전자/ }));

    expect(onSelect).toHaveBeenCalledWith('005930');
  });

  it('detail 패널에서 KRX/ECOS 캐시 컨텍스트를 별도 상세 정보로 표시한다', () => {
    render(
      <RecommendDetail
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

    expect(screen.getByText('최근 종가')).toBeInTheDocument();
    expect(screen.getByText('KRX 종가')).toBeInTheDocument();
    expect(screen.getByText('72,100원 (2026-04-28)')).toBeInTheDocument();
    expect(screen.getByText('KRX 시가총액')).toBeInTheDocument();
    expect(screen.getByText('430.0조원')).toBeInTheDocument();
    expect(screen.getByText('ECOS USD/KRW')).toBeInTheDocument();
    expect(screen.getByText('1,381.2원 (20260428)')).toBeInTheDocument();
  });

  it('이미 자동감시에 있는 종목은 선택 버튼을 비활성화하고 이유를 표시한다', () => {
    const onPick = vi.fn();
    render(
      <RecommendDetail
        item={baseItem()}
        onPick={onPick}
        isPickDisabled
        pickDisabledReason="이미 자동감시에 등록된 종목입니다."
      />,
    );

    const button = screen.getByRole('button', { name: '감시중' });
    expect(button).toBeDisabled();
    expect(screen.getByText(/이미 자동감시에 등록된 종목입니다/)).toBeInTheDocument();

    fireEvent.click(button);

    expect(onPick).not.toHaveBeenCalled();
  });
});
