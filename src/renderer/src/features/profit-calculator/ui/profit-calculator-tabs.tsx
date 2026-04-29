import { SegmentedToggle } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { ProfitCalculatorTab } from '../model/profit-calculator-types';

const TABS: Array<{ id: ProfitCalculatorTab; label: string }> = [
  { id: 'profit', label: '목표 수익률' },
  { id: 'rate', label: '매도금액 기준' },
];

interface ProfitCalculatorTabsProps {
  activeTab: ProfitCalculatorTab;
  onChange: (tab: ProfitCalculatorTab) => void;
}

export const ProfitCalculatorTabs = ({
  activeTab,
  onChange,
}: ProfitCalculatorTabsProps): ReactElement => (
  <div className="profit-calculator__tabs">
    <SegmentedToggle
      dense
      ariaLabel="수익률 계산 방식"
      value={activeTab}
      items={TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
      onChange={onChange}
    />
  </div>
);
