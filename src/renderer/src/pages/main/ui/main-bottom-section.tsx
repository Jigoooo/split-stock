import { TradeSelectionBar } from '@renderer/entities/stock';
import { PositionChart } from '@renderer/widgets/position-chart';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { LotOverlayLine } from '@shared/trading/lot-overlay';
import type { ReactElement } from 'react';
import type { MainSelectedEntry } from '../model/use-main-trading-context';

interface MainBottomSectionProps {
  isProd: boolean;
  onSelectStock: (entry: MainSelectedEntry) => void;
  overlayLines: LotOverlayLine[];
  selectedEntry: MainSelectedEntry | null;
}

export const MainBottomSection = ({
  isProd,
  onSelectStock,
  overlayLines,
  selectedEntry,
}: MainBottomSectionProps): ReactElement => (
  <div
    style={{
      height: '100%',
      padding: '0.8rem',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: '1.2rem',
    }}
  >
    <TradeSelectionBar selected={selectedEntry} onSelect={onSelectStock} />
    {selectedEntry ? (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 0.95fr) minmax(680px, 1.05fr)',
          gap: '1.2rem',
          flex: 1,
          minHeight: 0,
        }}
      >
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <PositionChart
            pdno={selectedEntry.pdno}
            name={selectedEntry.name}
            lines={overlayLines}
            enableDrawingTools={false}
          />
        </div>
        <div
          style={{
            minHeight: 0,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <TradingPanel pdno={selectedEntry.pdno} name={selectedEntry.name} isProd={isProd} />
        </div>
      </div>
    ) : null}
  </div>
);
