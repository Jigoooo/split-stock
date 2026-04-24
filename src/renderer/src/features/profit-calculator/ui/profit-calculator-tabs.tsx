import type { ReactElement } from 'react';
import type { ProfitCalculatorTab } from '../model/profit-calculator-types';
import { profitCalculatorStyles as styles } from './profit-calculator-styles';

const TABS: Array<{ id: ProfitCalculatorTab; label: string }> = [
  { id: 'profit', label: '수익률 계산' },
  { id: 'rate', label: '금액 계산' },
];

interface ProfitCalculatorTabsProps {
  activeTab: ProfitCalculatorTab;
  onChange: (tab: ProfitCalculatorTab) => void;
}

export const ProfitCalculatorTabs = ({
  activeTab,
  onChange,
}: ProfitCalculatorTabsProps): ReactElement => (
  <div style={styles.tabNav}>
    {TABS.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => onChange(tab.id)}
        style={{
          ...styles.tabButton,
          ...(activeTab === tab.id ? styles.tabButtonActive : styles.tabButtonInactive),
        }}
      >
        {tab.label}
      </button>
    ))}
  </div>
);
