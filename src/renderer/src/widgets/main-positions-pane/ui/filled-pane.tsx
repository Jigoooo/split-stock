import { TradeFeedPanel, useTradeFeed } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';

interface FeedBodyProps {
  pdno: string;
}

const FeedBody = ({ pdno }: FeedBodyProps): ReactElement => {
  const feed = useTradeFeed(pdno);
  return <TradeFeedPanel feed={feed} pdno={pdno} />;
};

export interface FilledPaneProps {
  selectedPdno: string | null;
}

/**
 * L2="실시간 체결" 탭 컨텐트.
 *
 * selectedPdno 가 없으면 안내 문구, 있으면 FeedBody 에 위임.
 * useTradeFeed 는 conditional 하게 호출할 수 없으므로 sub-component 분리.
 */
export const FilledPane = ({ selectedPdno }: FilledPaneProps): ReactElement => {
  if (selectedPdno === null) {
    return (
      <div className="panel">
        <div className="panel__body muted" style={{ fontSize: '1.05rem' }}>
          종목을 선택하세요
        </div>
      </div>
    );
  }
  return <FeedBody pdno={selectedPdno} />;
};
